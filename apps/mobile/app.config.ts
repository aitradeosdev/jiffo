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
    bundleId: process.env.CUSTOMER_BUNDLE_ID ?? 'app.jiffo.customer',
    background: '#0A7A4A',
  },
  agent: {
    name: 'Jiffo Agent',
    slug: 'jiffo-agent',
    scheme: 'jiffo-agent',
    bundleId: process.env.AGENT_BUNDLE_ID ?? 'app.jiffo.agent',
    background: '#0B0B0B',
  },
} as const;

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
    ios: { bundleIdentifier: v.bundleId, supportsTablet: false },
    android: {
      package: v.bundleId,
      adaptiveIcon: { foregroundImage: `./assets/${variant}/icon.png`, backgroundColor: v.background },
      predictiveBackGestureEnabled: false,
    },
    web: { favicon: `./assets/${variant}/favicon.png`, output: 'single' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-font',
      ['expo-splash-screen', { image: `./assets/${variant}/icon.png`, imageWidth: 120, backgroundColor: v.background }],
      'expo-notifications',
      [
        'expo-image-picker',
        {
          photosPermission: 'Jiffo uses your photos so you can share them with your agent in chat.',
          cameraPermission: 'Jiffo uses the camera for receipts, item photos and drop-off photos.',
        },
      ],
    ],
    experiments: { typedRoutes: false },
    extra: {
      variant,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
      country: process.env.EXPO_PUBLIC_COUNTRY ?? 'NG',
    },
  };
};
