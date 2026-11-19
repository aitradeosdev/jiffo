import type { ConfigContext, ExpoConfig } from 'expo/config';

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

/** Smile ID's face detectors' build settings: ML Kit on Android, Apple's Vision on iOS. KSP as their samples use. */
const SMILE_ID_PLUGINS: NonNullable<ExpoConfig['plugins']> = [
  ['@smileid/usesmileid_mlkit_face', { kspVersion: '2.3.6' }],
  '@smileid/usesmileid_vision_face',
];

export default ({ config }: ConfigContext): ExpoConfig => {
  const v = VARIANTS[variant];
  return {
    ...config,
    name: v.name,
    slug: v.slug,
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
              locationWhenInUsePermission: 'Jiffo Agent uses your location to show errands near you.',
              locationAlwaysAndWhenInUsePermission:
                "Jiffo Agent shares your location while you're online or on an errand, also when you switch to your maps app, so customers can follow their errand.",
              // While online or on an errand, the phone keeps sending the agent's location from the background.
              isAndroidBackgroundLocationEnabled: true,
              isAndroidForegroundServiceEnabled: true,
              isIosBackgroundLocationEnabled: true,
            }
          : { locationWhenInUsePermission: 'Jiffo uses your location to show where you are on the map.' },
      ],
      // Android draws Google Maps and needs a key at build time; iOS uses Apple Maps, which needs none.
      ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
      // Smile ID's selfie checks (docs/security-plan.md, I2, I8). Only the agent app uses them, but native
      // modules are linked into both builds, which compile only with these settings.
      ...SMILE_ID_PLUGINS,
    ],
    experiments: { typedRoutes: false },
    extra: {
      variant,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
      country: process.env.EXPO_PUBLIC_COUNTRY ?? 'NG',
      // The Google Cloud project linked to the apps in Play Console, for Play Integrity (MB3). Not a secret.
      playCloudProjectNumber: process.env.PLAY_CLOUD_PROJECT_NUMBER ?? '',
    },
  };
};
