import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceReceiptsApi } from '@/features/api/resources';
import { useSession, type ApiRole } from '@/features/api/session';
import type { ApiReceiptReview } from '@/features/api/types';
import { ReceiptReviewDrawer } from './ReceiptReviewDrawer';

vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  serviceReceiptsApi: { review: vi.fn(), verify: vi.fn(), reject: vi.fn(), retry: vi.fn(), reopen: vi.fn() },
}));
vi.mock('./ReceiptViewer', () => ({ ReceiptViewer: () => null }));

const review = vi.mocked(serviceReceiptsApi.review);
const verify = vi.mocked(serviceReceiptsApi.verify);

function fixture(overrides: Partial<ApiReceiptReview['ai']> = {}): ApiReceiptReview {
  return {
    record: {
      id: 'exp-1',
      category: 'MAINTENANCE',
      amount: '1000.00',
      expenseDate: '2026-03-04',
      vendorName: 'Typed by driver',
      description: null,
      status: 'ACTIVE',
      vehicle: { id: 'veh-1', registrationNumber: 'KA 22 AB 1234' },
      driver: { id: 'drv-1', driverCode: 'GR-D-1', fullName: 'Ramesh Kumar' },
      service: {
        invoiceNumber: null, serviceType: null, odometerKm: null, nextServiceDate: null, nextServiceKm: null,
        labourAmount: null, partsAmount: null, taxAmount: null, lineItems: [],
      },
    },
    receipt: { fileId: 'file-1', filename: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, uploadedAt: '2026-03-04T10:00:00Z' },
    ai: {
      status: 'NEEDS_REVIEW', verifiedAt: null, verifiedById: null, rejectedAt: null, acceptedResultId: null,
      acceptedFields: [], canVerify: true, canRetry: true, ...overrides,
    },
    results: [
      {
        id: 'res-1', version: 1, provider: 'ollama', model: 'vision-model', confidence: 0.55, warnings: [],
        validationIssues: ['The receipt totals ₹2596.00, but ₹1000.00 was entered on this record.'],
        preparation: 'image+ocr', sourceTextChars: 420, durationMs: 9000, createdAt: '2026-03-04T10:01:00Z',
      },
    ],
    jobs: [],
    extraction: {
      vendorName: 'Sharma Auto Works', invoiceNumber: 'INV-2291', invoiceDate: '2026-03-04', vehicleNumber: 'KA 22 AB 1234',
      serviceType: 'Brake service', odometerKm: 48200, nextServiceDate: null, nextServiceKm: 58200,
      lineItems: [
        { description: 'Brake pad set', kind: 'PART', quantity: 1, unitPrice: 1700, amount: 1700 },
        { description: 'Labour', kind: 'LABOUR', quantity: 1, unitPrice: 500, amount: 500 },
      ],
      partsAmount: 1700, labourAmount: 500, gstAmount: 396, otherCharges: null, subtotal: 2200, totalAmount: 2596,
      confidence: 0.55, warnings: [],
    },
    suggestions: {
      totalAmount: { value: 2596, state: 'found' },
      invoiceDate: { value: '2026-03-04', state: 'found' },
      vendorName: { value: 'Sharma Auto Works', state: 'found' },
      invoiceNumber: { value: 'INV-2291', state: 'found' },
      serviceType: { value: 'Brake service', state: 'found' },
      odometerKm: { value: 48200, state: 'found' },
      nextServiceDate: { value: null, state: 'missing' },
      nextServiceKm: { value: 58200, state: 'found' },
      labourAmount: { value: 500, state: 'found' },
      partsAmount: { value: 1700, state: 'found' },
      taxAmount: { value: 396, state: 'found' },
    },
  };
}

const signIn = (role: ApiRole) =>
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role, companyId: 'c1', employeeId: null, driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Office', email: 'o@example.test', phone: null },
  });

beforeEach(() => {
  signIn('ADMIN');
  review.mockReset();
  verify.mockReset().mockResolvedValue({ id: 'exp-1', aiStatus: 'VERIFIED', aiVerifiedAt: '2026-03-05T00:00:00Z', acceptedFields: [], correctedFields: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('ReceiptReviewDrawer', () => {
  it('starts from the record, not from the reading, and says how the receipt was read', async () => {
    review.mockResolvedValue(fixture());
    render(<ReceiptReviewDrawer expenseId="exp-1" onClose={() => {}} />);

    expect(await screen.findByText('Check closely')).toBeTruthy();
    // The amount on the form is the one on the record; the reading is only offered beside it.
    expect((screen.getByDisplayValue('1000.00') as HTMLInputElement).value).toBe('1000.00');
    expect(screen.getByText('Read from the photo with OCR')).toBeTruthy();
    expect(screen.getByText(/was entered on this record/)).toBeTruthy();
    // A value the receipt did not give is said to be missing — never offered as anything.
    expect(screen.getAllByText('not on the receipt')).toHaveLength(1);
  });

  it('sends only what the person put on the form, including the structured details they took across', async () => {
    review.mockResolvedValue(fixture());
    render(<ReceiptReviewDrawer expenseId="exp-1" onClose={() => {}} />);
    await screen.findByText('Check closely');

    fireEvent.click(screen.getByRole('button', { name: /Use ₹2,596/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 48,200 km' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use the 2 line(s) read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify record' }));

    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    const [id, body] = verify.mock.calls[0]!;
    expect(id).toBe('exp-1');
    expect(body).toMatchObject({
      amount: '2596.00',
      odometerKm: 48200,
      // Not taken across, so it stays as the record had it: empty.
      invoiceNumber: null,
      nextServiceDate: null,
      resultId: 'res-1',
      lineItems: [
        { description: 'Brake pad set', kind: 'PART', quantity: '1', unitPrice: '1700.00', amount: '1700.00' },
        { description: 'Labour', kind: 'LABOUR', quantity: '1', unitPrice: '500.00', amount: '500.00' },
      ],
    });
  });

  it('closes a verified record to editing, and only the fleet roles may re-open it', async () => {
    review.mockResolvedValue(fixture({ status: 'VERIFIED', canVerify: false, canRetry: false, verifiedAt: '2026-03-05T00:00:00Z' }));
    const { unmount } = render(<ReceiptReviewDrawer expenseId="exp-1" onClose={() => {}} />);
    expect(await screen.findAllByText('Verified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify record' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-open' })).toBeTruthy();
    unmount();

    signIn('ACCOUNTING');
    render(<ReceiptReviewDrawer expenseId="exp-1" onClose={() => {}} />);
    await screen.findAllByText('Verified');
    expect(screen.queryByRole('button', { name: 'Re-open' })).toBeNull();
  });
});
