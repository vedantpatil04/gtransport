/* Test doubles for the native modules the foundation layers depend on. */

jest.setTimeout(15000);

jest.mock('@react-native-async-storage/async-storage', () => {
  const mockStore = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
      setItem: jest.fn(async (key, value) => { mockStore.set(key, String(value)); }),
      removeItem: jest.fn(async (key) => { mockStore.delete(key); }),
      multiRemove: jest.fn(async (keys) => { for (const key of keys) mockStore.delete(key); }),
      multiGet: jest.fn(async (keys) => keys.map((key) => [key, mockStore.has(key) ? mockStore.get(key) : null])),
      clear: jest.fn(async () => { mockStore.clear(); }),
      __store: mockStore,
    },
  };
});

jest.mock('expo-secure-store', () => {
  const mockSecure = new Map();
  return {
    isAvailableAsync: jest.fn(async () => true),
    setItemAsync: jest.fn(async (key, value) => { mockSecure.set(key, value); }),
    getItemAsync: jest.fn(async (key) => (mockSecure.has(key) ? mockSecure.get(key) : null)),
    deleteItemAsync: jest.fn(async (key) => { mockSecure.delete(key); }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __store: mockSecure,
  };
});

// Waking the API is a real network request; no test should make it.
jest.mock('./src/lib/api/warmup', () => ({ wakeApi: jest.fn(async () => true), WAKE_TIMEOUT_MS: 75000 }));

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageCode: 'en' }]) }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient',
  },
  AppOwnership: {
    Expo: 'expo',
    Standalone: 'standalone',
    Guest: 'guest',
  },
  default: {
    executionEnvironment: 'bare',
    appOwnership: null,
    expoConfig: { extra: { apiUrl: 'https://api.test.gangamata', appEnv: 'development' } },
  },
}));

jest.mock('expo-location', () => {
  const started = new Set();
  return {
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
    ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 },
    hasServicesEnabledAsync: jest.fn(async () => true),
    getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
    getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
    requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
    requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
    // Background updates are held in a set so tests can assert that tracking really was
    // registered — rather than that a function happened to be called.
    startLocationUpdatesAsync: jest.fn(async (task) => { started.add(task); }),
    stopLocationUpdatesAsync: jest.fn(async (task) => { started.delete(task); }),
    hasStartedLocationUpdatesAsync: jest.fn(async (task) => started.has(task)),
    __started: started,
  };
});

jest.mock('expo-task-manager', () => {
  const tasks = new Map();
  return {
    defineTask: jest.fn((name, handler) => { tasks.set(name, handler); }),
    isTaskDefined: jest.fn((name) => tasks.has(name)),
    isTaskRegisteredAsync: jest.fn(async (name) => tasks.has(name)),
    unregisterTaskAsync: jest.fn(async (name) => { tasks.delete(name); }),
    __tasks: tasks,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 24, right: 0, bottom: 16, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => children,
    useSafeAreaInsets: () => inset,
    SafeAreaView: ({ children }) => children,
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((listener) => {
      listener({ isConnected: true, isInternetReachable: true });
      return () => undefined;
    }),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'device-token' })),
}));

jest.mock('expo-crypto', () => {
  let mockCounter = 0;
  return { randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String((mockCounter += 1)).padStart(12, '0')}`) };
});

jest.mock('expo-file-system', () => {
  const mockFiles = new Set();
  class MockDirectory {
    constructor(...parts) { this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/'); }
    get exists() { return true; }
    create() {}
  }
  class MockFile {
    constructor(...parts) { this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/'); }
    get exists() { return mockFiles.has(this.uri); }
    async copy(destination) { mockFiles.add(destination.uri); }
    delete() { mockFiles.delete(this.uri); }
  }
  return { Directory: MockDirectory, File: MockFile, Paths: { document: new MockDirectory('file:///documents') }, __files: mockFiles };
});

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cache/photo.jpg', mimeType: 'image/jpeg' }] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cache/gallery.jpg', mimeType: 'image/jpeg' }] })),
}));

jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: jest.fn(() => ({})),
  useFocusEffect: jest.fn(),
  useSegments: jest.fn(() => []),
}));

// Native MapLibre (the office Fleet map). Host views stand in for the native map, camera and
// markers, carrying the props the screen passed (style URL, marker coordinates, initial view) so
// tests assert on what the native map would be told. The camera's imperative calls are recorded.
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');
  const mockCamera = {
    fitBounds: jest.fn(),
    easeTo: jest.fn(),
    flyTo: jest.fn(),
    jumpTo: jest.fn(),
    zoomTo: jest.fn(),
    setStop: jest.fn(async () => undefined),
  };
  const Map = ({ children, ...props }) => React.createElement(View, props, children);
  const Camera = ({ ref, ...props }) => {
    React.useImperativeHandle(ref, () => mockCamera, []);
    return React.createElement(View, { testID: 'maplibre-camera', ...props });
  };
  const Marker = ({ id, children, ...props }) =>
    React.createElement(Pressable, { testID: `maplibre-marker-${id}`, ...props }, children);
  return { __esModule: true, Map, Camera, Marker, __camera: mockCamera };
});

// The office console WebView. A host view stands in for it, carrying the props the screen passed
// (address, navigation policy, message handler) so tests can drive them; reload/goBack are recorded.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mockWebView = { reload: jest.fn(), goBack: jest.fn() };
  const WebView = ({ ref, ...props }) => {
    React.useImperativeHandle(ref, () => mockWebView, []);
    return React.createElement(View, props);
  };
  return { __esModule: true, WebView, default: WebView, __webView: mockWebView };
});
