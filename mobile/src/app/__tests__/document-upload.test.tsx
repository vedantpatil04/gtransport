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
  useLocalSearchParams: () => ({ type: 'RC' }),
  useRouter: () => ({ back: jest.fn() }),
}));

describe('RC Document Upload Screen', () => {
  beforeAll(async () => {
    await initI18n();
    await setLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useSession.setState({ token: 'test-token', status: 'signedIn' });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders RC document upload screen with pick options and form fields', async () => {
    await render(<UploadDocumentScreen />);
    expect(screen.getByText('RC')).toBeTruthy();
    expect(screen.getByTestId('doc-source-camera')).toBeTruthy();
    expect(screen.getByTestId('doc-source-gallery')).toBeTruthy();
    expect(screen.getByTestId('doc-source-file')).toBeTruthy();
    expect(screen.getByTestId('doc-expiry')).toBeTruthy();
    expect(screen.getByTestId('doc-number')).toBeTruthy();
    expect(screen.getByTestId('doc-save')).toBeTruthy();
  });

  it('prompts when saving without choosing a file', async () => {
    await render(<UploadDocumentScreen />);
    fireEvent.press(screen.getByTestId('doc-save'));
    expect(await screen.findByText('Take a photo or choose a file first')).toBeTruthy();
    expect(uploadDocumentFile).not.toHaveBeenCalled();
    expect(documentsApi.save).not.toHaveBeenCalled();
  });

  it('successfully uploads RC document and shows completed state', async () => {
    jest.spyOn(capture, 'chooseFromGallery').mockResolvedValueOnce({
      status: 'ok',
      receipt: { uri: 'file:///path/to/rc.jpg', mimeType: 'image/jpeg', name: 'rc.jpg' },
    });
    jest.mocked(uploadDocumentFile).mockResolvedValueOnce('file-uuid-777');
    jest.mocked(documentsApi.save).mockResolvedValueOnce({
      id: 'doc-uuid-888',
      type: 'RC',
      documentNumber: null,
      expiryDate: null,
      status: 'VALID',
      daysRemaining: 1200,
      verificationStatus: 'PENDING',
      rejectionReason: null,
      file: { id: 'file-uuid-777', fileName: 'rc.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 },
    });

    await render(<UploadDocumentScreen />);

    await fireEvent.press(screen.getByTestId('doc-source-gallery'));
    await waitFor(() => expect(capture.chooseFromGallery).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId('doc-save'));

    await waitFor(() => {
      expect(uploadDocumentFile).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ uri: 'file:///path/to/rc.jpg' }),
        expect.any(Function),
      );
      expect(documentsApi.save).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          type: 'RC',
          fileId: 'file-uuid-777',
        }),
      );
    });

    expect(await screen.findByTestId('doc-upload-done')).toBeTruthy();
    expect(screen.getByText(/Uploaded/)).toBeTruthy();
  });

  it('displays useful backend error on failure without false success and allows retry', async () => {
    jest.spyOn(capture, 'chooseFromGallery').mockResolvedValue({
      status: 'ok',
      receipt: { uri: 'file:///path/to/rc.jpg', mimeType: 'image/jpeg', name: 'rc.jpg' },
    });
    jest.mocked(uploadDocumentFile).mockRejectedValueOnce(
      new ApiError('validation', 400, 'No vehicle is assigned to you. Ask the office to assign one first.'),
    );

    await render(<UploadDocumentScreen />);

    await fireEvent.press(screen.getByTestId('doc-source-gallery'));
    await waitFor(() => expect(capture.chooseFromGallery).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId('doc-save'));

    expect(await screen.findByText('No vehicle is assigned to you. Ask the office to assign one first.')).toBeTruthy();
    expect(screen.queryByTestId('doc-upload-done')).toBeNull();

    // Allows retry
    expect(screen.getByText('Try again')).toBeTruthy();

    // Now mock success for retry
    jest.mocked(uploadDocumentFile).mockResolvedValueOnce('file-uuid-retry');
    jest.mocked(documentsApi.save).mockResolvedValueOnce({
      id: 'doc-uuid-retry',
      type: 'RC',
      documentNumber: null,
      expiryDate: null,
      status: 'VALID',
      daysRemaining: null,
      verificationStatus: 'PENDING',
      rejectionReason: null,
      file: null,
    });

    fireEvent.press(screen.getByTestId('doc-save'));

    await waitFor(() => {
      expect(uploadDocumentFile).toHaveBeenCalledTimes(2);
      expect(documentsApi.save).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('doc-upload-done')).toBeTruthy();
  });
});
