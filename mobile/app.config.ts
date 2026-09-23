import type { ExpoConfig } from 'expo/config';

/**
 * Gangamata Transport — driver app configuration.
 *
 * The API URL comes from the environment so development, staging and production can point at
 * different backends without code changes; nothing secret is stored here. EAS build profiles
 * supply EXPO_PUBLIC_API_URL per environment.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';

/** Brand navy, matching --primary in the approved web app. */
const BRAND_NAVY = '#1B2B44';

const config: ExpoConfig = {
  name: 'Gangamata Transport',
  slug: 'gangamata-transport-driver',
  scheme: 'gangamata',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F2F4F7',
  primaryColor: BRAND_NAVY,
  assetBundlePatterns: ['assets/**/*'],

  android: {
    package: 'in.gangamatatransport.driver',
    adaptiveIcon: {
      backgroundColor: BRAND_NAVY,
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // The expo-location plugin below contributes the location and foreground-service
    // permissions (including background), so only the notification permission is listed here.
    permissions: ['POST_NOTIFICATIONS'],
  },

  ios: {
    bundleIdentifier: 'in.gangamatatransport.driver',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Gangamata Transport uses your location so the office can see where the fleet is while you are on duty.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Gangamata Transport uses your location in the background so the office can see where the fleet is while you are on duty.',
      UIBackgroundModes: ['location'],
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  web: { output: 'static', favicon: './assets/images/favicon.png' },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        backgroundColor: BRAND_NAVY,
        image: './assets/images/splash-mark.png',
        imageWidth: 180,
        resizeMode: 'contain',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Gangamata Transport uses your location so the office can see where the fleet is while you are on duty.',
        locationWhenInUsePermission:
          'Gangamata Transport uses your location so the office can see where the fleet is while you are on duty.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],

  experiments: { typedRoutes: true },

  extra: {
    apiUrl: API_URL,
    /** development | staging | production — drives non-secret behaviour such as logging. */
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
  },
};

export default config;
