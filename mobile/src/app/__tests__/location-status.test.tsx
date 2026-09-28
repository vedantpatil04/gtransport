import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { LocationStatusCard } from '../../features/location/LocationStatusCard';
import { enqueueFix } from '../../lib/location/buffer';
import { savePolicy } from '../../lib/location/tracking';
import type { TrackingPolicy } from '../../types/domain';

/**
 * What the driver actually sees.
 *
 * The card has one job: say whether the office can see this vehicle, and if not, offer the single
 * action that would fix it. The tests below check that it never claims tracking is working when it
 * is not, and that the offered action matches the reason — a prompt where a prompt still helps, and
 * the settings screen once Android has stopped showing one.
 */

const mockedLocation = Location as unknown as {
  hasServicesEnabledAsync: jest.Mock;
  getForegroundPermissionsAsync: jest.Mock;
  getBackgroundPermissionsAsync: jest.Mock;
  requestForegroundPermissionsAsync: jest.Mock;
  requestBackgroundPermissionsAsync: jest.Mock;
  startLocationUpdatesAsync: jest.Mock;
  hasStartedLocationUpdatesAsync: jest.Mock;
  __started: Set<string>;
};

// Spied rather than module-mocked, so the real Linking surface is what gets called. iOS opens the
// app's settings page by URL and Android has a dedicated call, so both are watched and either
// counts: the assertion is "the driver was taken to Settings", not which API did it.
let openSettings: jest.SpyInstance;
let openUrl: jest.SpyInstance;
const settingsOpened = () => openSettings.mock.calls.length + openUrl.mock.calls.length;

const granted = { status: 'granted', canAskAgain: true };
const denied = (canAskAgain = true) => ({ status: 'denied', canAskAgain });

const POLICY: TrackingPolicy = {
  movingIntervalSeconds: 60,
  stationaryIntervalSeconds: 900,
  distanceMeters: 150,
  bufferLimit: 100,
  maxBatchSize: 10,
  staleAfterMinutes: 15,
};

const signedInDriver = () =>
  useSession.setState({
    status: 'signedIn',
    token: 'test-token',
    role: 'DRIVER',
    user: null,
    driver: { status: 'ACTIVE' } as never,
    expiredMessage: false,
  });

const mockFetch = (fn: jest.Mock) => {
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
};

/**
 * Renders and lets the first tracking pass settle.
 *
 * That pass reads permissions, checks the task and drains the buffer — several awaits deep — so the
 * microtask queue is flushed inside `act`. Without it React reports the resulting state update as
 * happening outside a test-managed render.
 */
const show = async () => {
  await act(async () => {
    render(<LocationStatusCard />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(screen.getByTestId('location-status')).toBeTruthy());
};

/** Presses the card and lets the resulting asynchronous work finish. */
const press = async () => {
  await act(async () => {
    fireEvent.press(screen.getByTestId('location-status'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('the driver\'s location indicator', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockedLocation.__started.clear();
    await AsyncStorage.clear();
    await initI18n();
    await savePolicy(POLICY);
    mockedLocation.hasServicesEnabledAsync.mockResolvedValue(true);
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(granted);
    mockedLocation.getBackgroundPermissionsAsync.mockResolvedValue(granted);
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue(granted);
    mockedLocation.requestBackgroundPermissionsAsync.mockResolvedValue(granted);
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({}) }));
    signedInDriver();
  });

  it('says tracking is active once it really is', async () => {
    await show();

    await waitFor(() => expect(screen.getByText('Tracking active')).toBeTruthy());
  });

  it('asks for permission when the driver has refused it', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(denied());
    await show();

    await waitFor(() => expect(screen.getByText('Tracking needs permission')).toBeTruthy());
    // A prompt will still appear, so that is what is offered.
    expect(screen.getByText('Allow location')).toBeTruthy();
  });

  it('offers settings, not a prompt, once Android has stopped asking', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(denied(false));
    await show();

    await waitFor(() => expect(screen.getByText('Open location settings')).toBeTruthy());

    await press();
    // Re-prompting would do nothing and would look broken to the driver.
    await waitFor(() => expect(settingsOpened()).toBeGreaterThan(0));
    expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('says location services are off, which the driver fixes outside the app', async () => {
    mockedLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    await show();

    await waitFor(() => expect(screen.getByText('Location services are off')).toBeTruthy());
    expect(screen.getByText('Open location settings')).toBeTruthy();
  });

  it('asks again for background permission when only the foreground was granted', async () => {
    mockedLocation.getBackgroundPermissionsAsync.mockResolvedValue(denied());
    await show();

    // Tracking would stop the moment the driver leaves the screen, so this is not "active".
    await waitFor(() => expect(screen.getByText('Tracking needs permission')).toBeTruthy());

    await press();
    await waitFor(() => expect(mockedLocation.requestForegroundPermissionsAsync).toHaveBeenCalled());
    // Android refuses a background request unless foreground is already held, hence the order.
    expect(mockedLocation.requestBackgroundPermissionsAsync).toHaveBeenCalled();
  });

  it('shows how many positions are waiting to send', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    await enqueueFix(
      { latitude: 15.85, longitude: 74.498, capturedAt: new Date().toISOString(), clientSubmissionId: 'waiting-1' },
      POLICY.bufferLimit,
    );

    await show();

    await waitFor(() => expect(screen.getByText('1 location waiting to send')).toBeTruthy());
    // The driver can retry by hand rather than waiting for the next automatic pass.
    expect(screen.getByText('Send now')).toBeTruthy();
  });

  it('reports tracking as off duty when nobody is signed in', async () => {
    useSession.setState({ status: 'signedOut', token: null, role: null, user: null, driver: null, expiredMessage: false });

    await show();

    await waitFor(() => expect(screen.getByText('Tracking off duty')).toBeTruthy());
  });

  it('stops tracking for a driver who has been stood down', async () => {
    useSession.setState({ driver: { status: 'SUSPENDED' } as never });

    await show();

    // No service should run for a driver the office has taken off the road.
    await waitFor(() => expect(screen.getByText('Tracking off duty')).toBeTruthy());
  });
});
