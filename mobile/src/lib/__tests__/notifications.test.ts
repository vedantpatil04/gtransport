import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import {
  getDeviceToken,
  isEnabled,
  isExpoGo,
  isPushSupported,
  readPermission,
  requestPermission,
  setEnabled,
} from '../notifications/notifications';

jest.mock('expo', () => {
  return {
    isRunningInExpoGo: jest.fn(() => false),
  };
});

describe('notifications module', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    Constants.executionEnvironment = ExecutionEnvironment.Bare;
    (Constants as unknown as { appOwnership?: string }).appOwnership = undefined;
    (isRunningInExpoGo as unknown as jest.Mock).mockReturnValue(false);
  });

  describe('when running inside Expo Go', () => {
    beforeEach(() => {
      Constants.executionEnvironment = ExecutionEnvironment.StoreClient;
      (isRunningInExpoGo as unknown as jest.Mock).mockReturnValue(true);
    });

    it('identifies environment as Expo Go', () => {
      expect(isExpoGo()).toBe(true);
      expect(isPushSupported()).toBe(false);
    });

    it('returns unsupported permission state without calling native notifications', async () => {
      const permission = await readPermission();
      expect(permission).toBe('unsupported');
      expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    });

    it('returns unsupported when requesting permission without crashing or calling native module', async () => {
      const permission = await requestPermission();
      expect(permission).toBe('unsupported');
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('returns null for device token without faking registration or calling native module', async () => {
      const token = await getDeviceToken();
      expect(token).toBeNull();
      expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    });

    it('persists preferences but does not trigger native permission request on enable', async () => {
      expect(await isEnabled()).toBe(true);

      await setEnabled(false);
      expect(await isEnabled()).toBe(false);

      await setEnabled(true);
      expect(await isEnabled()).toBe(true);
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  describe('when running inside development build or production build', () => {
    beforeEach(() => {
      Constants.executionEnvironment = ExecutionEnvironment.Bare;
      (isRunningInExpoGo as unknown as jest.Mock).mockReturnValue(false);
    });

    it('identifies environment as not Expo Go', () => {
      expect(isExpoGo()).toBe(false);
      expect(isPushSupported()).toBe(true);
    });

    it('reads permissions from expo-notifications', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        canAskAgain: true,
      });

      expect(await readPermission()).toBe('granted');
      expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
    });

    it('returns undetermined when permissions can be asked again', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'undetermined',
        canAskAgain: true,
      });

      expect(await readPermission()).toBe('undetermined');
    });

    it('requests permissions via expo-notifications', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
      });

      expect(await requestPermission()).toBe('granted');
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    it('retrieves device token when permissions are granted', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        canAskAgain: true,
      });
      (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
        data: 'real-device-push-token-123',
      });

      const token = await getDeviceToken();
      expect(token).toBe('real-device-push-token-123');
      expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalled();
    });

    it('returns null when permission is not granted', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
        canAskAgain: false,
      });

      const token = await getDeviceToken();
      expect(token).toBeNull();
      expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    });

    it('requests permissions when toggling enabled if status is undetermined', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'undetermined',
        canAskAgain: true,
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
      });

      await setEnabled(true);
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    });
  });
});
