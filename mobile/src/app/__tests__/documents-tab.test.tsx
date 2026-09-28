import { render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { initI18n, setLanguage } from '../../i18n';
import { documentsApi, type ComplianceItem, type MyDocuments } from '../../lib/api/documents';
import { useSession } from '../../lib/auth/session-store';
import DocumentsScreen from '../(tabs)/documents';

jest.mock('../../lib/api/documents', () => ({
  documentsApi: { mine: jest.fn(), save: jest.fn() },
  uploadDocumentFile: jest.fn(),
}));

// Run focus effects like a mount, so the tab loads as it does on screen.
jest.mocked(jest.requireMock('expo-router').useFocusEffect).mockImplementation((effect: () => void) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
});

const doc = (overrides: Partial<NonNullable<ComplianceItem['document']>>): NonNullable<ComplianceItem['document']> => ({
  id: 'd', type: 'INSURANCE', documentNumber: null, expiryDate: '2026-10-07', status: 'VALID', daysRemaining: 100,
  verificationStatus: 'VERIFIED', rejectionReason: null, file: { id: 'f', fileName: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
  ...overrides,
});

const payload: MyDocuments = {
  vehicle: {
    id: 'v1',
    registrationNumber: 'KA 22 AB 1234',
    documents: [
      { type: 'RC', status: 'VALID', daysRemaining: 900, document: doc({ type: 'RC' }) },
      { type: 'INSURANCE', status: 'EXPIRING_SOON', daysRemaining: 18, document: doc({ status: 'EXPIRING_SOON', daysRemaining: 18 }) },
      { type: 'PUC', status: 'NOT_UPLOADED', daysRemaining: null, document: null },
      { type: 'TYRE_INSURANCE', status: 'EXPIRED', daysRemaining: -3, document: doc({ type: 'TYRE_INSURANCE', status: 'EXPIRED', daysRemaining: -3, verificationStatus: 'REJECTED', rejectionReason: 'Photo is blurred' }) },
    ],
  },
  personal: [{ type: 'DRIVING_LICENCE', status: 'VALID', daysRemaining: 400, document: doc({ type: 'DRIVING_LICENCE', verificationStatus: 'PENDING' }) }],
};

describe('driver documents tab', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await setLanguage('en');
    useSession.setState({ token: 'token-1', status: 'signedIn' });
    jest.mocked(documentsApi.mine).mockResolvedValue(payload);
  });

  it('shows vehicle documents and the driver\'s own licence', async () => {
    await render(<DocumentsScreen />);
    expect(await screen.findByText('Vehicle documents · KA 22 AB 1234')).toBeTruthy();
    for (const title of ['RC', 'Insurance', 'PUC', 'Tyre Insurance', 'Driving Licence']) expect(screen.getByText(title)).toBeTruthy();
  });

  it('says plainly how each document stands', async () => {
    await render(<DocumentsScreen />);
    expect(await screen.findByText('Expires in 18 days')).toBeTruthy();
    expect(screen.getByTestId('doc-status-RC').props.children).toBe('Valid');
    expect(screen.getByTestId('doc-status-TYRE_INSURANCE').props.children).toBe('Expired 3 days ago');
  });

  it('shows a missing document as Not uploaded, never as expired', async () => {
    await render(<DocumentsScreen />);
    expect((await screen.findByTestId('doc-status-PUC')).props.children).toBe('Not uploaded');
    expect(screen.getByTestId('doc-upload-PUC')).toBeTruthy();
    expect(screen.getByText('Upload')).toBeTruthy();
  });

  it('shows verification as Verified or Needs attention, with the reason', async () => {
    await render(<DocumentsScreen />);
    expect((await screen.findAllByText('Verified')).length).toBeGreaterThan(0);
    expect(screen.getByText('Needs attention · Photo is blurred')).toBeTruthy();
    expect(screen.getByText('Being checked')).toBeTruthy();
  });

  it('offers Replace for uploaded documents and View when there is a file', async () => {
    await render(<DocumentsScreen />);
    await screen.findByText('Expires in 18 days');
    expect(screen.getAllByText('Replace')).toHaveLength(4);
    expect(screen.getAllByText('View')).toHaveLength(4);
  });

  it('works in the driver\'s language', async () => {
    await setLanguage('kn');
    await render(<DocumentsScreen />);
    expect(await screen.findByText('18 ದಿನಗಳಲ್ಲಿ ಮುಕ್ತಾಯ')).toBeTruthy();
    expect(screen.getByTestId('doc-status-PUC').props.children).toBe('ಅಪ್‌ಲೋಡ್ ಆಗಿಲ್ಲ');
  });
});
