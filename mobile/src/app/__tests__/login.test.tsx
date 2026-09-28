import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import LoginScreen from '../(auth)/login';

describe('login screen', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    useSession.setState({ status: 'signedOut', token: null, user: null, role: null, driver: null, expiredMessage: false });
  });

  it('asks for the mobile number first', async () => {
    await render(<LoginScreen />);
    expect(await screen.findByTestId('login-mobile')).toBeTruthy();
    expect(screen.queryByTestId('login-passcode')).toBeNull();
  });

  it('will not move on until a full mobile number is entered', async () => {
    await render(<LoginScreen />);

    await fireEvent.changeText(screen.getByTestId('login-mobile'), '98450');
    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Enter your 10-digit mobile number')).toBeTruthy();
    expect(screen.queryByTestId('login-passcode')).toBeNull();
  });

  it('moves to the passcode step once the number is valid', async () => {
    await render(<LoginScreen />);

    await fireEvent.changeText(screen.getByTestId('login-mobile'), '9845012301');
    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-passcode')).toBeTruthy();
  });

  it('signs in with the number and passcode', async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    useSession.setState({ signIn } as never);

    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('login-mobile'), '9845012301');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await fireEvent.changeText(await screen.findByTestId('login-passcode'), 'secret-passcode');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('9845012301', 'secret-passcode'));
  });

  it('shows the server message when the credentials are wrong', async () => {
    const { ApiError } = jest.requireActual('../../lib/api/client') as typeof import('../../lib/api/client');
    useSession.setState({ signIn: jest.fn().mockRejectedValue(new ApiError('unauthorized', 401, 'no')) } as never);

    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('login-mobile'), '9845012301');
    await fireEvent.press(screen.getByTestId('login-submit'));
    await fireEvent.changeText(await screen.findByTestId('login-passcode'), 'wrong');
    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(await screen.findByText('That number or passcode is not correct.')).toBeTruthy();
  });

  it('lets office staff sign in with an email address and a password', async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    useSession.setState({ signIn } as never);

    await render(<LoginScreen />);
    await fireEvent.press(screen.getByTestId('login-use-email'));
    await fireEvent.changeText(await screen.findByTestId('login-email'), ' Owner@Gangamata.test ');
    await fireEvent.press(screen.getByTestId('login-submit'));
    await fireEvent.changeText(await screen.findByTestId('login-passcode'), 'Owner-Pass-2026');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('Owner@Gangamata.test', 'Owner-Pass-2026'));
  });

  it('asks for a real email address in email mode', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByTestId('login-use-email'));
    await fireEvent.changeText(await screen.findByTestId('login-email'), 'not-an-email');
    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
  });

  it.each([
    ['ACCOUNT_SUSPENDED', 'This account is suspended. Please contact your office.'],
    ['ACCOUNT_DISABLED', 'This account no longer has access. Please contact your office.'],
  ])('explains a %s account instead of calling the password wrong', async (code, message) => {
    const { ApiError } = jest.requireActual('../../lib/api/client') as typeof import('../../lib/api/client');
    useSession.setState({ signIn: jest.fn().mockRejectedValue(new ApiError('forbidden', 403, 'no', code)) } as never);

    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('login-mobile'), '9845012301');
    await fireEvent.press(screen.getByTestId('login-submit'));
    await fireEvent.changeText(await screen.findByTestId('login-passcode'), 'right-passcode');
    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('explains when a session ended rather than failing silently', async () => {
    useSession.setState({ expiredMessage: true });
    await render(<LoginScreen />);

    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy();
  });
});
