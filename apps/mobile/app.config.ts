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
      // Android draws Google Maps and needs a key at build time; iOS uses Apple Maps, which needs none.
      ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
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
    },
  };
};
