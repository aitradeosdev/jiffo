import type { ConfigContext, ExpoConfig } from 'expo/config';
import EAS_PROJECTS from './eas-projects.json';

/**
 * One codebase, two store apps. APP_VARIANT picks which one is built:
 *   customer (default): Jiffo
 *   agent:              Jiffo Agent
 * Bundle identifiers can be overridden per variant before the first store release.
 */
type Variant = 'customer' | 'agent';
const variant: Variant = process.env.APP_VARIANT === 'agent' ? 'agent' : 'customer';

const VARIANTS = {
  customer: {
    name: 'Jiffo',
    slug: 'jiffo',
    scheme: 'jiffo',
    bundleId: process.env.CUSTOMER_BUNDLE_ID ?? 'com.jiffoapp.customer',
    background: '#0A7A4A',
  },
  agent: {
    name: 'Jiffo Agent',
    slug: 'jiffo-agent',
    scheme: 'jiffo-agent',
    bundleId: process.env.AGENT_BUNDLE_ID ?? 'com.jiffoapp.agent',
    background: '#0B0B0B',
  },
} as const;

/**
 * The API's address, from EXPO_PUBLIC_API_URL, or the computer running the bundler for development. A preview
 * or store build talks to the API over HTTPS only, so one built on Expo's servers without an HTTPS address stops
 * there, rather than ship an app that calls the phone itself (docs/mobile-builds.md).
 */
export const apiUrlFor = (env: Record<string, string | undefined>) => {
  const url = env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
  const profile = env.EAS_BUILD_PROFILE ?? '';
  if (env.EAS_BUILD === 'true' && /^(preview|production)/.test(profile) && !url.startsWith('https://')) {
    throw new Error(
      `The ${profile} build needs EXPO_PUBLIC_API_URL set to the API's https:// address in its EAS environment (docs/mobile-builds.md)`,
    );
  }
  return url;
};

/**
 * The Google Maps keys for the map drawn in the apps (Maps SDK for Android, Maps SDK for iOS). Both phones draw
 * Google's map: places are found with Google, whose terms keep its results off other companies' maps. An iPhone
 * build without its key draws Apple's map, and an Android one a blank map, so a store build made on Expo's
 * servers stops without its phone's key (docs/mobile-builds.md).
 */
export const googleMapsFor = (env: Record<string, string | undefined>) => {
  const android = env.GOOGLE_MAPS_ANDROID_API_KEY || undefined;
  const ios = env.GOOGLE_MAPS_IOS_API_KEY || undefined;
  const profile = env.EAS_BUILD_PROFILE ?? '';
  if (env.EAS_BUILD === 'true' && /^production/.test(profile)) {
    const missing =
      env.EAS_BUILD_PLATFORM === 'android' && !android
        ? 'GOOGLE_MAPS_ANDROID_API_KEY'
        : env.EAS_BUILD_PLATFORM === 'ios' && !ios
          ? 'GOOGLE_MAPS_IOS_API_KEY'
          : null;
    if (missing) {
      throw new Error(
        `The ${profile} build for ${env.EAS_BUILD_PLATFORM} needs ${missing} in its EAS environment, or its map would be ${missing.includes('IOS') ? "Apple's" : 'blank'} (docs/mobile-builds.md)`,
      );
    }
  }
  return { android, ios };
};

/** The longest pins may be set to last: a forgotten build falls back to normal certificate checks in time. */
const PIN_MAX_DAYS = 400;

export interface PinningSettings {
  /** The hosts pinned: the API's, unless PINNING_HOSTS names them. Exactly these, not their subdomains. */
  hosts: string[];
  /** Base64 SHA-256 hashes of certificate authorities' public keys (SPKI), each with the authority's name. */
  pins: { ca: string; hash: string }[];
  /** yyyy-MM-dd (UTC): from this day the apps check certificates as normal, without the pins. */
  expires: string;
  /** Where the apps fetch the signed remote switch, on a host they don't pin. */
  switchUrl: string;
  /** The switch's Ed25519 public key, base64 (32 bytes), from `pnpm --filter @jiffo/api pinning-switch keygen`. */
  switchKey: string;
  /**
   * When the build was made: a switch signed before it can't turn its pins off, so an old "off" can't be replayed
   * to a new install, which has kept no later "on".
   */
  issuedAfter: string;
}

/**
 * Certificate pinning's build settings (docs/security/pinning.md, MB7), or null while no pins are set: it ships
 * off. Once PINNING_PINS is set the build stops unless the settings follow the rules: authorities' keys, never the
 * server's own certificate, at least two from two different authorities, an end date, and a signed switch on a
 * host that isn't pinned.
 */
export function pinningFor(env: Record<string, string | undefined>, now = Date.now()): PinningSettings | null {
  const list = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const entries = list(env.PINNING_PINS);
  if (!entries.length) return null;
  const fail = (why: string): never => {
    throw new Error(`Certificate pinning (docs/security/pinning.md): ${why}`);
  };

  const pins = entries.map((entry) => {
    const at = entry.lastIndexOf(':');
    const ca = at > 0 ? entry.slice(0, at).trim() : '';
    const hash = entry.slice(at + 1).trim();
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(ca)) {
      fail(`each pin in PINNING_PINS is written authority:hash, naming its certificate authority (${entry})`);
    }
    if (!/^[A-Za-z0-9+/]{43}=$/.test(hash) || Buffer.from(hash, 'base64').length !== 32) {
      fail(`a pin must be the base64 SHA-256 hash of a certificate authority's public key (${entry})`);
    }
    return { ca, hash };
  });
  if (pins.length < 2) fail('PINNING_PINS needs at least two pins, so one can take over from the other');
  if (new Set(pins.map((p) => p.hash)).size !== pins.length) fail('PINNING_PINS has the same pin twice');
  if (new Set(pins.map((p) => p.ca.toLowerCase())).size < 2) {
    fail('PINNING_PINS needs pins from at least two different certificate authorities');
  }

  const expires = env.PINNING_EXPIRES ?? '';
  const end = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? Date.parse(`${expires}T00:00:00Z`) : NaN;
  if (Number.isNaN(end) || end <= now) fail('PINNING_EXPIRES must be a day after today, written yyyy-MM-dd');
  if (end - now > PIN_MAX_DAYS * 86_400_000) fail('PINNING_EXPIRES may be at most 13 months away');

  const api = new URL(apiUrlFor(env));
  if (api.protocol !== 'https:') fail("the API's address (EXPO_PUBLIC_API_URL) must be https:// to be pinned");
  // Host names as the phone compares them: lowercase, no scheme, port or path.
  const hosts = list(env.PINNING_HOSTS).length ? list(env.PINNING_HOSTS).map((h) => h.toLowerCase()) : [api.hostname];
  for (const host of hosts) {
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) {
      fail(`PINNING_HOSTS takes plain host names, such as api.example.com (${host})`);
    }
  }
  if (!hosts.includes(api.hostname)) fail(`PINNING_HOSTS must include the API's host (${api.hostname})`);

  const switchUrl = env.PINNING_SWITCH_URL ?? '';
  if (!switchUrl) fail('PINNING_SWITCH_URL must name where the signed switch is published');
  let switchHost = '';
  try {
    const url = new URL(switchUrl);
    if (url.protocol !== 'https:') fail('PINNING_SWITCH_URL must be https://');
    switchHost = url.hostname;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Certificate pinning')) throw error;
    fail('PINNING_SWITCH_URL must be a full https:// address');
  }
  if (hosts.includes(switchHost)) {
    fail('PINNING_SWITCH_URL must be on a host that is not pinned, so it can still be fetched when the pins fail');
  }
  const switchKey = env.PINNING_SWITCH_KEY ?? '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(switchKey) || Buffer.from(switchKey, 'base64').length !== 32) {
    fail('PINNING_SWITCH_KEY must be the switch public key `pinning-switch keygen` printed');
  }
  return { hosts, pins, expires, switchUrl, switchKey, issuedAfter: new Date(now).toISOString() };
}

/**
 * The Expo project of the app being built, for EAS builds: each store app is its own project, named in
 * eas-projects.json once `eas init` has made it (docs/mobile-builds.md). Not a secret.
 */
export const easProject = (projects: Record<Variant, string>, which: Variant) =>
  projects[which] ? { eas: { projectId: projects[which] } } : {};

/** Smile ID's face detectors' build settings: ML Kit on Android, Apple's Vision on iOS. KSP as their samples use. */
const SMILE_ID_PLUGINS: NonNullable<ExpoConfig['plugins']> = [
  ['@smileid/usesmileid_mlkit_face', { kspVersion: '2.3.6' }],
  '@smileid/usesmileid_vision_face',
];

/**
 * Release builds of both Android apps are shrunk and obfuscated with R8 (docs/security-plan.md, MB7). Each
 * native library ships its own keep rules for what it reaches by name (docs/security/sdks.md lists them), and
 * our two modules need none beyond Expo's. These keep the file and line numbers, so a crash report can be read
 * back with the build's mapping file, with every file named the same, and Room's databases, which its own rules
 * left unmade.
 */
const ANDROID_KEEP_RULES = `
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Room makes each database's generated class through its no-argument constructor, by reflection: WorkManager's
# WorkDatabase_Impl, as Android starts the app. R8 took the constructor for unused and the app closed at once.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
`;

export default ({ config }: ConfigContext): ExpoConfig => {
  const v = VARIANTS[variant];
  const googleMaps = googleMapsFor(process.env);
  return {
    ...config,
    name: v.name,
    slug: v.slug,
    // The Expo account the projects belong to (eas-projects.json): development's now, the production account's
    // before the store builds.
    ...(EAS_PROJECTS.owner ? { owner: EAS_PROJECTS.owner } : {}),
    scheme: v.scheme,
    version: '0.1.0',
    orientation: 'portrait',
    icon: `./assets/${variant}/icon.png`,
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: v.bundleId,
      supportsTablet: false,
      // App Attest (docs/security-plan.md, MB3): store builds use Apple's production environment; a development
      // build can set APP_ATTEST_ENVIRONMENT=development, which the API counts as doubtful in production.
      entitlements: {
        'com.apple.developer.devicecheck.appattest-environment':
          process.env.APP_ATTEST_ENVIRONMENT === 'development' ? 'development' : 'production',
      },
    },
    android: {
      package: v.bundleId,
      adaptiveIcon: { foregroundImage: `./assets/${variant}/icon.png`, backgroundColor: v.background },
      predictiveBackGestureEnabled: false,
      // The app is left out of Android's cloud backups (docs/security-plan.md, MB2). A cable or Wi-Fi transfer
      // to a new phone may still copy its files, but the tokens in them are sealed with keys that stay in the
      // old phone's keystore, so they can't be read there.
      allowBackup: false,
    },
    web: { favicon: `./assets/${variant}/favicon.png`, output: 'single' },
    plugins: [
      'expo-router',
      [
        'expo-secure-store',
        // Face ID fills in the app PIN for money actions, when the agent turns it on (docs/security-plan.md, A7).
        { faceIDPermission: 'Jiffo uses Face ID to confirm money actions instead of typing your PIN.' },
      ],
      'expo-font',
      ['expo-splash-screen', { image: `./assets/${variant}/icon.png`, imageWidth: 120, backgroundColor: v.background }],
      'expo-notifications',
      'expo-web-browser',
      [
        'expo-image-picker',
        {
          photosPermission: 'Jiffo uses your photos so you can share them with your agent in chat.',
          cameraPermission:
            variant === 'agent'
              ? 'Jiffo Agent uses the camera for receipts, item photos, drop-off photos, and the selfie that checks it is you.'
              : 'Jiffo uses the camera for receipts, item photos and drop-off photos.',
        },
      ],
      [
        'expo-location',
        variant === 'agent'
          ? {
              locationWhenInUsePermission:
                "Jiffo Agent uses your location to show errands near you, and to tell Jiffo's safety team where you are if you press Emergency.",
              locationAlwaysAndWhenInUsePermission:
                "Jiffo Agent shares your location while you're online or on an errand, also when you switch to your maps app, so customers can follow their errand.",
              // While online or on an errand, the phone keeps sending the agent's location from the background.
              isAndroidBackgroundLocationEnabled: true,
              isAndroidForegroundServiceEnabled: true,
              isIosBackgroundLocationEnabled: true,
            }
          : {
              locationWhenInUsePermission:
                "Jiffo uses your location to show where you are on the map, and to tell Jiffo's safety team where you are if you press Emergency.",
            },
      ],
      // Both phones draw Google's map, each with its own key at build time; an iPhone build without one draws
      // Apple's (googleMapsFor).
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: googleMaps.android,
          ...(googleMaps.ios ? { iosGoogleMapsApiKey: googleMaps.ios } : {}),
        },
      ],
      // Smile ID's selfie checks (docs/security-plan.md, I2, I8). Only the agent app uses them, but native
      // modules are linked into both builds, which compile only with these settings.
      ...SMILE_ID_PLUGINS,
      // Lets Smile ID's plugin pin its Kotlin version in Expo 58's template; listed after it so it runs first.
      './plugins/with-plain-kotlin-classpath.cjs',
      [
        'expo-build-properties',
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            extraProguardRules: ANDROID_KEEP_RULES,
          },
        },
      ],
    ],
    experiments: { typedRoutes: false },
    extra: {
      variant,
      apiUrl: apiUrlFor(process.env),
      country: process.env.EXPO_PUBLIC_COUNTRY ?? 'NG',
      // The Google Cloud project linked to the apps in Play Console, for Play Integrity (MB3). Not a secret.
      playCloudProjectNumber: process.env.PLAY_CLOUD_PROJECT_NUMBER ?? '',
      ...easProject(EAS_PROJECTS, variant),
      // Whether the iPhone build has Google's map in it, to draw it rather than Apple's (src/ui/map/engine.ts).
      googleMapsOnIos: !!googleMaps.ios,
      // Certificate pinning (MB7): null, so off, until its build settings are filled in.
      pinning: pinningFor(process.env),
    },
  };
};
