import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import i18n, { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import ChangePasswordScreen from '../(auth)/change-password';

describe('change password on first sign-in', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    useSession.setState({ status: 'signedIn', token: 'token', role: 'ACCOUNTING', driver: null, expiredMessage: false });
  });

  const fill = async (current: string, next: string, repeat: string) => {
    await render(<ChangePasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('password-current'), current);
    await fireEvent.changeText(screen.getByTestId('password-new'), next);
    await fireEvent.changeText(screen.getByTestId('password-repeat'), repeat);
    await fireEvent.press(screen.getByTestId('password-submit'));
  };

  it('sends the temporary and the new password to the session', async () => {
    const changePassword = jest.fn().mockResolvedValue(undefined);
    useSession.setState({ changePassword } as never);

    await fill('abcd-efgh', 'a-new-password', 'a-new-password');

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('abcd-efgh', 'a-new-password'));
  });

  it('will not send a new password that does not match its repeat', async () => {
    const changePassword = jest.fn();
    useSession.setState({ changePassword } as never);

    await fill('abcd-efgh', 'a-new-password', 'a-new-passwrd');

    expect(await screen.findByText(i18n.t('password.errRepeat'))).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('says so when the server refuses the temporary password', async () => {
    const { ApiError } = jest.requireActual('../../lib/api/client') as typeof import('../../lib/api/client');
    useSession.setState({
      changePassword: jest.fn().mockRejectedValue(new ApiError('validation', 400, 'no', undefined, undefined, { currentPassword: 'The current password is not correct.' })),
    } as never);

    await fill('wrong-temp', 'a-new-password', 'a-new-password');

    expect(await screen.findByText(i18n.t('password.errCurrent'))).toBeTruthy();
  });
});
