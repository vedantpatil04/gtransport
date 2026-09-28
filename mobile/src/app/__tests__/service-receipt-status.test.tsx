import { act, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initI18n, setLanguage } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { ServiceReceiptStatus } from '../../features/daily/ServiceReceiptStatus';
import type { DriverServiceReceipt } from '../../types/domain';

/**
 * What a driver is told about the bills they photographed.
 *
 * The rule this file protects is a narrow one and easy to break by accident: a driver sees where
 * their bill has got to, and nothing about how it was read. No model, no confidence, no queue, no
 * "AI". The assertions below check the words on the screen, because that is where such a leak would
 * actually show up — a field quietly added to the response would otherwise go unnoticed until a
 * driver was looking at it.
 */

const receipt = (over: Partial<DriverServiceReceipt> = {}): DriverServiceReceipt => ({
  id: `r-${Math.random().toString(36).slice(2, 8)}`,
  amount: '2596.00',
  serviceDate: '2026-03-04',
  vendorName: 'Sharma Auto Works',
  vehicleRegistration: 'KA 22 AB 1234',
  hasReceipt: true,
  state: 'processing',
  submittedAt: '2026-03-04T09:00:00.000Z',
  ...over,
});

const mockFetch = (fn: jest.Mock) => {
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
};

const respondWith = (receipts: DriverServiceReceipt[]) =>
  jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ data: receipts })),
  });

const show = async () => {
  await act(async () => {
    render(<ServiceReceiptStatus />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('what the driver is told about their service bills', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await initI18n();
    useSession.setState({
      status: 'signedIn',
      token: 'test-token',
      role: 'DRIVER',
      user: null,
      driver: { status: 'ACTIVE' } as never,
      expiredMessage: false,
    });
  });

  it('shows the amount and where the bill has got to', async () => {
    mockFetch(respondWith([receipt({ state: 'processing' })]));
    await show();

    await waitFor(() => expect(screen.getByText('₹2,596')).toBeTruthy());
    expect(screen.getByText('Being read')).toBeTruthy();
    expect(screen.getByText('The bill is being read. Nothing needed from you.')).toBeTruthy();
  });

  it('asks its own endpoint, which carries no driver id', async () => {
    const fetcher = respondWith([receipt()]);
    mockFetch(fetcher);
    await show();

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const url = String(fetcher.mock.calls[0][0]);
    expect(url).toContain('/service-receipts/mine');
    // The driver comes from the session. A driver id on the route would be a way to ask for
    // somebody else's uploads.
    expect(url).not.toMatch(/driver/i);
  });

  it('never mentions the model, its confidence, or AI at all', async () => {
    mockFetch(
      respondWith([
        receipt({ state: 'uploaded' }),
        receipt({ state: 'processing' }),
        receipt({ state: 'needsReview' }),
        receipt({ state: 'verified' }),
        receipt({ state: 'failed' }),
      ]),
    );
    await show();

    await waitFor(() => expect(screen.getByTestId('service-receipts')).toBeTruthy());
    const rendered = JSON.stringify(screen.toJSON());
    for (const forbidden of ['AI', 'confidence', 'model', 'OCR', 'queue', 'Ollama', 'extraction']) {
      expect(rendered.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('says the office is checking, not that the driver must do something', async () => {
    mockFetch(respondWith([receipt({ state: 'needsReview' })]));
    await show();

    await waitFor(() => expect(screen.getByText('With the office')).toBeTruthy());
    expect(screen.getByText('The office is checking it. Nothing needed from you.')).toBeTruthy();
  });

  it('does not suggest the expense was refused when the photo could not be read', async () => {
    // The distinction matters on a forecourt: reading failed, the claim did not.
    mockFetch(respondWith([receipt({ state: 'failed' })]));
    await show();

    await waitFor(() => expect(screen.getByText('Not read')).toBeTruthy());
    const hint = screen.getByText(/could not be read/);
    expect(hint).toBeTruthy();
    expect(String(hint.props.children)).toContain('Your expense is recorded');
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/rejected|refused|declined/i);
  });

  it('shows a confirmed bill as checked', async () => {
    mockFetch(respondWith([receipt({ state: 'verified' })]));
    await show();

    await waitFor(() => expect(screen.getByText('Checked')).toBeTruthy());
    expect(screen.getByText('The office has checked and confirmed this.')).toBeTruthy();
  });

  it('renders nothing at all when the driver has sent none', async () => {
    mockFetch(respondWith([]));
    await show();

    await waitFor(() => expect(screen.queryByTestId('service-receipts')).toBeNull());
  });

  it('stays quiet when the list cannot be loaded, rather than alarming the driver', async () => {
    // The entries are safely on the server and there is nothing for a driver to do about a failed
    // fetch, so a red banner on the main screen would be noise.
    mockFetch(jest.fn().mockRejectedValue(new Error('offline')));
    await show();

    await waitFor(() => expect(screen.queryByTestId('service-receipts')).toBeNull());
  });

  it('speaks the driver\'s own language', async () => {
    await setLanguage('hi');
    mockFetch(respondWith([receipt({ state: 'verified' })]));
    await show();

    await waitFor(() => expect(screen.getByText('जाँच हो गई')).toBeTruthy());
    // Switching back re-renders the mounted card, so it belongs inside act like any other update.
    await act(async () => {
      await setLanguage('en');
    });
  });
});
