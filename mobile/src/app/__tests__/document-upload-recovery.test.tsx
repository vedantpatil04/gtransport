import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { initI18n, setLanguage } from '../../i18n';
import { ApiError } from '../../lib/api/client';
import { documentsApi, uploadDocumentFile } from '../../lib/api/documents';
import { useSession } from '../../lib/auth/session-store';
import * as capture from '../../lib/receipts/capture';
import UploadDocumentScreen from '../document/upload';

jest.mock('../../lib/api/documents', () => ({
  documentsApi: { save: jest.fn(), mine: jest.fn() },
  uploadDocumentFile: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ type: 'INSURANCE' }),
  useRouter: () => ({ back: jest.fn() }),
}));

const saved = {
  id: 'doc-1',
  type: 'INSURANCE' as const,
  documentNumber: 'POL-778899',
  expiryDate: null,
  status: 'VALID' as const,
  daysRemaining: 300,
  verificationStatus: 'PENDING' as const,
  rejectionReason: null,
  file: null,
};

/** The save has finished (success or failure) once the progress bar is gone; assert nothing sooner. */
const saveFinished = () => waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());

async function pickPhoto() {
  jest.spyOn(capture, 'chooseFromGallery').mockResolvedValue({
    status: 'ok',
    receipt: { uri: 'file:///cache/ImagePicker/insurance.png', mimeType: 'image/png', name: 'insurance.png' },
  });
  await fireEvent.press(screen.getByTestId('doc-source-gallery'));
  await waitFor(() => expect(capture.chooseFromGallery).toHaveBeenCalled());
}

describe('Insurance upload — failures keep the file and the form, and retry only what is missing', () => {
  beforeAll(async () => {
    await initI18n();
    await setLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useSession.setState({ token: 'test-token', status: 'signedIn' });
  });

  afterEach(() => cleanup());

  it('says what happened and what to do when the connection fails — the file and the number stay on screen', async () => {
    jest.mocked(uploadDocumentFile).mockRejectedValueOnce(new ApiError('network', 0, 'Could not reach the server.'));
    await render(<UploadDocumentScreen />);
    await pickPhoto();
    await fireEvent.changeText(screen.getByTestId('doc-number'), 'POL-778899');

    await fireEvent.press(screen.getByTestId('doc-save'));

    expect(await screen.findByText(/No connection to the server\. Your file and details are kept/)).toBeTruthy();
    await saveFinished();
    expect(screen.queryByTestId('doc-upload-done')).toBeNull();
    expect(screen.getByTestId('doc-number').props.value).toBe('POL-778899');
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(documentsApi.save).not.toHaveBeenCalled();
  });

  it('tells the driver plainly when the chosen file has gone from the phone', async () => {
    jest.mocked(uploadDocumentFile).mockRejectedValueOnce(new ApiError('file', 0, 'The photo or file is no longer on this phone.'));
    await render(<UploadDocumentScreen />);
    await pickPhoto();
    await fireEvent.press(screen.getByTestId('doc-save'));

    expect(await screen.findByText(/no longer on this phone\. Take a photo or choose the file again/)).toBeTruthy();
    await saveFinished();
  });

  it('shows the server reference when the server fails, so the office can find it', async () => {
    jest.mocked(uploadDocumentFile).mockRejectedValueOnce(new ApiError('server', 503, 'unavailable', 'SERVICE_UNAVAILABLE', 'cf871239-42c5-4782'));
    await render(<UploadDocumentScreen />);
    await pickPhoto();
    await fireEvent.press(screen.getByTestId('doc-save'));

    expect(await screen.findByText(/try again in a minute\. Reference cf871239/)).toBeTruthy();
    await saveFinished();
  });

  it('when the file is stored but saving the record fails, retrying does not upload the file again — and never double-records', async () => {
    jest.mocked(uploadDocumentFile).mockResolvedValue('file-already-stored');
    jest.mocked(documentsApi.save)
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'The server is taking too long to respond.'))
      .mockResolvedValueOnce(saved);
    await render(<UploadDocumentScreen />);
    await pickPhoto();
    await fireEvent.changeText(screen.getByTestId('doc-number'), 'POL-778899');

    await fireEvent.press(screen.getByTestId('doc-save'));
    expect(await screen.findByText(/The upload took too long/)).toBeTruthy();
    await saveFinished();
    expect(screen.queryByTestId('doc-upload-done')).toBeNull();

    await fireEvent.press(screen.getByTestId('doc-save'));
    expect(await screen.findByTestId('doc-upload-done')).toBeTruthy();
    await saveFinished();

    expect(uploadDocumentFile).toHaveBeenCalledTimes(1);
    expect(documentsApi.save).toHaveBeenCalledTimes(2);
    const [first, second] = jest.mocked(documentsApi.save).mock.calls.map((call) => call[1]);
    expect(first).toMatchObject({ type: 'INSURANCE', fileId: 'file-already-stored', documentNumber: 'POL-778899' });
    // Same submission id both times: the server records it once however often it is sent.
    expect(second).toEqual(first);
  });

  it('uploads again when the driver picks a different file after a failure', async () => {
    jest.mocked(uploadDocumentFile).mockResolvedValueOnce('file-one');
    jest.mocked(documentsApi.save).mockRejectedValueOnce(new ApiError('network', 0, 'offline'));
    await render(<UploadDocumentScreen />);
    await pickPhoto();
    await fireEvent.press(screen.getByTestId('doc-save'));
    await screen.findByText(/No connection to the server/);
    await saveFinished();

    jest.mocked(uploadDocumentFile).mockResolvedValueOnce('file-two');
    jest.mocked(documentsApi.save).mockResolvedValueOnce(saved);
    await pickPhoto();
    await fireEvent.press(screen.getByTestId('doc-save'));

    expect(await screen.findByTestId('doc-upload-done')).toBeTruthy();
    await saveFinished();
    expect(uploadDocumentFile).toHaveBeenCalledTimes(2);
    expect(documentsApi.save).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ fileId: 'file-two' }));
  });
});
