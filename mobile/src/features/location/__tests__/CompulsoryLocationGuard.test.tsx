import React from 'react';
import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { initI18n, setLanguage } from '../../../i18n';
import { CompulsoryLocationGuard } from '../CompulsoryLocationGuard';
import { useSession } from '../../../lib/auth/session-store';
import * as useTrackingModule from '../useTracking';

jest.mock('../useTracking');

describe('CompulsoryLocationGuard', () => {
  const mockResolve = jest.fn();
  const mockSignOut = jest.fn();

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await setLanguage('en');
    jest.clearAllMocks();
    useSession.setState({
      token: 'jwt-driver-token',
      role: 'DRIVER',
      driver: {
        id: 'driver-1',
        driverCode: 'DRV-001',
        status: 'ACTIVE',
        employee: {
          fullName: 'Ramesh Patil',
          employeeCode: 'EMP-001',
        },
      } as any,
      signOut: mockSignOut,
    });
  });

  it('renders children when driver tracking is active', async () => {
    jest.spyOn(useTrackingModule, 'useTracking').mockReturnValue({
      state: 'active',
      action: 'none',
      resolve: mockResolve,
      sync: jest.fn(),
      busy: false,
      snapshot: null,
      pendingUploads: 0,
      droppedFixes: 0,
    });

    await render(
      <CompulsoryLocationGuard>
        <Text testID="operational-content">Driver Operational App</Text>
      </CompulsoryLocationGuard>,
    );

    expect(screen.getByTestId('operational-content')).toBeTruthy();
  });

  it('renders children when tracking is in syncPending status', async () => {
    jest.spyOn(useTrackingModule, 'useTracking').mockReturnValue({
      state: 'syncPending',
      action: 'none',
      resolve: mockResolve,
      sync: jest.fn(),
      busy: false,
      snapshot: null,
      pendingUploads: 3,
      droppedFixes: 0,
    });

    await render(
      <CompulsoryLocationGuard>
        <Text testID="operational-content">Driver Operational App</Text>
      </CompulsoryLocationGuard>,
    );

    expect(screen.getByTestId('operational-content')).toBeTruthy();
  });

  it('bypasses guard when user is not a driver', async () => {
    useSession.setState({
      role: 'ADMIN',
      driver: null,
    });

    jest.spyOn(useTrackingModule, 'useTracking').mockReturnValue({
      state: 'needsPermission',
      action: 'requestPermission',
      resolve: mockResolve,
      sync: jest.fn(),
      busy: false,
      snapshot: null,
      pendingUploads: 0,
      droppedFixes: 0,
    });

    await render(
      <CompulsoryLocationGuard>
        <Text testID="operational-content">Admin Dashboard</Text>
      </CompulsoryLocationGuard>,
    );

    expect(screen.getByTestId('operational-content')).toBeTruthy();
  });

  it('shows compulsory blocking screen when location permission is needed', async () => {
    jest.spyOn(useTrackingModule, 'useTracking').mockReturnValue({
      state: 'needsPermission',
      action: 'requestPermission',
      resolve: mockResolve,
      sync: jest.fn(),
      busy: false,
      snapshot: {
        permission: {
          stage: 'UNDETERMINED',
          foreground: 'UNDETERMINED',
          background: 'UNDETERMINED',
          servicesEnabled: true,
          canAskAgain: true,
          canAskBackgroundAgain: true,
        },
      } as any,
      pendingUploads: 0,
      droppedFixes: 0,
    });

    await render(
      <CompulsoryLocationGuard>
        <Text testID="operational-content">Driver Operational App</Text>
      </CompulsoryLocationGuard>,
    );

    // Operational content is blocked
    expect(screen.queryByTestId('operational-content')).toBeNull();

    // Compulsory prompt action button is present
    const actionBtn = screen.getByTestId('compulsory-location-action');
    expect(actionBtn).toBeTruthy();

    fireEvent.press(actionBtn);
    expect(mockResolve).toHaveBeenCalled();
  });

  it('shows settings action when settings are required to enable background location', async () => {
    jest.spyOn(useTrackingModule, 'useTracking').mockReturnValue({
      state: 'needsPermission',
      action: 'openSettings',
      resolve: mockResolve,
      sync: jest.fn(),
      busy: false,
      snapshot: {
        permission: {
          stage: 'GRANTED',
          foreground: 'GRANTED',
          background: 'DENIED',
          servicesEnabled: true,
          canAskAgain: false,
          canAskBackgroundAgain: false,
        },
      } as any,
      pendingUploads: 0,
      droppedFixes: 0,
    });

    await render(
      <CompulsoryLocationGuard>
        <Text testID="operational-content">Driver Operational App</Text>
      </CompulsoryLocationGuard>,
    );

    expect(screen.queryByTestId('operational-content')).toBeNull();

    const actionBtn = screen.getByTestId('compulsory-location-action');
    expect(actionBtn).toBeTruthy();
    fireEvent.press(actionBtn);
    expect(mockResolve).toHaveBeenCalled();
  });
});

