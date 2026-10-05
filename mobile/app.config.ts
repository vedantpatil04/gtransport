import type { ExpoConfig } from 'expo/config';
import { withProjectBuildGradle, type ConfigPlugin } from '@expo/config-plugins';

/**
 * Gangamata Transport — driver app configuration.
 *
 * The API URL comes from the environment so development, staging and production can point at
 * different backends without code changes; nothing secret is stored here. EAS build profiles
 * supply EXPO_PUBLIC_API_URL per environment.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';

/**
 * The MapLibre style the office Fleet map draws (tile source, fonts, look). Configuration, not
 * code: pointing a build at a self-hosted or contracted tile server is an environment change.
 * Deliberately no default — without it the Fleet screen says the map is not configured.
 */
const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL;

/** Brand navy, matching --primary in the approved web app. */
const BRAND_NAVY = '#1B2B44';

const withAndroidSharedCppPlugin: ConfigPlugin = (config) => {
  return withProjectBuildGradle(config, (modConfig) => {
    const snippet = `  def configureAndroid = { project ->
    def androidExt = project.extensions.findByName("android")
    if (androidExt != null) {
      androidExt.defaultConfig {
        externalNativeBuild {
          cmake {
            arguments "-DCMAKE_SHARED_LINKER_FLAGS=-lc++_shared"
          }
        }
      }
    }
  }
  plugins.withId("com.android.application") { configureAndroid(delegate) }
  plugins.withId("com.android.library") { configureAndroid(delegate) }`;
    if (!modConfig.modResults.contents.includes('CMAKE_SHARED_LINKER_FLAGS')) {
      modConfig.modResults.contents = modConfig.modResults.contents.replace(
        /allprojects\s*\{[\s\S]*?repositories\s*\{[\s\S]*?\}\s*\}/,
        (match) => `${match}\n${snippet}`
      );
    }
    return modConfig;
  });
};

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
    // Development builds: the app includes the native modules Expo Go lacks (e.g. Android push).
    ['expo-dev-client', { launchMode: 'most-recent' }],
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        cameraPermission: 'Gangamata Transport uses the camera to photograph fuel and service receipts.',
        photosPermission: 'Gangamata Transport lets you choose a receipt photo from your gallery.',
        microphonePermission: false,
      },
    ],
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
    // Native MapLibre (Android/iOS SDKs) for the office Live Fleet map. No Mapbox or Google key.
    '@maplibre/maplibre-react-native',
  ],

  experiments: { typedRoutes: true },

  extra: {
    apiUrl: API_URL,
    /** development | staging | production — drives non-secret behaviour such as logging. */
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    mapStyleUrl: MAP_STYLE_URL,
  },
};

export default withAndroidSharedCppPlugin(config);
