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

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageCode: 'en' }]) }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://api.test.gangamata', appEnv: 'development' } } },
}));

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  hasServicesEnabledAsync: jest.fn(async () => true),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
}));

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
