import * as SecureStore from 'expo-secure-store';
import authMe from './contracts/auth-me.json';
import documentsMine from './contracts/documents-mine.json';
import driverMe from './contracts/driver-me.json';
import errorValidation from './contracts/error-validation.json';
import fuelCreate from './contracts/fuel-create.json';
import fuelList from './contracts/fuel-list.json';
import login from './contracts/login.json';
import operationsList from './contracts/operations-list.json';
import paymentsMine from './contracts/payments-mine.json';
import receiptUpload from './contracts/receipt-upload.json';
import { accountApi } from '../api/account';
import { ApiError, apiRequest } from '../api/client';
import { documentsApi, uploadDocumentFile } from '../api/documents';
import { driverApi } from '../api/driver';
import { fuelApi, operationsApi, uploadReceipt } from '../api/operations';
import { driverPaymentState, paymentsApi, rupees } from '../api/payments';
import { useSession } from '../auth/session-store';
import { clearSession } from '../storage/secure';
import { FakeXhr } from './helpers/fake-xhr';

/**
 * Replays REAL API responses (captured by backend/test/mobile-contract.e2e-spec.ts) through the
 * app's own code. Phase 2's login bug slipped through because tests mocked the shape the app
 * assumed; these fixtures are what the server actually sends.
 */

const respond = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const mockFetch = (fn: jest.Mock) => {
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
};

describe('API contract — real responses through mobile code', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    useSession.setState({ status: 'signedOut', token: null, user: null, role: null, driver: null, expiredMessage: false });
  });

  it('signs in with the real login response and keeps the server\'s absolute expiry', async () => {
    mockFetch(
      jest
        .fn()
        .mockResolvedValueOnce(respond(200, login))
        .mockResolvedValueOnce(respond(200, driverMe)),
    );

    await useSession.getState().signIn('9845012301', 'passcode');

    expect(useSession.getState().status).toBe('signedIn');
    const [, stored] = (SecureStore.setItemAsync as jest.Mock).mock.calls.at(-1) as [string, string];
    // The bug: the app read a relative `expiresIn` the API did not send. It must use expiresAt.
    expect(JSON.parse(stored).expiresAt).toBe(Date.parse(login.expiresAt));
    expect(JSON.parse(stored)).toMatchObject({ userId: login.user.id, role: 'DRIVER' });
    // The role from the real response picks the app; the password never reaches storage.
    expect(useSession.getState().role).toBe('DRIVER');
    expect(stored).not.toContain('passcode');
  });

  it('restores the session from the real /auth/me response, reading the role fresh', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, authMe)));
    const user = await accountApi.me('token');

    expect(user).toEqual(login.user);
    expect(user.displayName).toEqual(expect.any(String));
    expect(typeof user.mustChangePassword).toBe('boolean');
    expect(JSON.stringify(authMe)).not.toMatch(/passwordHash|sessionVersion/);
  });

  it('reads the driver profile fields the screens display', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, driverMe)));
    const profile = await driverApi.me('token');

    expect(profile.employee.fullName).toEqual(expect.any(String));
    expect(profile.employee.employeeCode).toEqual(expect.any(String));
    expect(profile.driverCode).toEqual(expect.any(String));
    expect(profile.currentAssignment?.vehicle.registrationNumber).toEqual(expect.any(String));
  });

  it('reads the fuel entry the server returns, including its derived rate', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(201, fuelCreate)));
    const entry = await fuelApi.create('token', {
      fuelType: 'DIESEL', amount: 2450, litres: 25, fuelStation: 'IndianOil', transactionDate: '2026-09-19', clientSubmissionId: 'x',
    });

    expect(entry.ratePerLitre).toBe('98.00');
    expect(Number(entry.amount)).toBe(2450);
    expect(entry.vehicle.registrationNumber).toEqual(expect.any(String));
  });

  it('reads fuel history totals as the history screen does', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, fuelList)));
    const page = await fuelApi.list('token', { from: '2026-09-19', to: '2026-09-19' });

    expect(Number(page.totals.amount)).toBeGreaterThan(0);
    expect(page.totals).toHaveProperty('averageRate');
    expect(Array.isArray(page.data)).toBe(true);
  });

  it('reads the operations total the home summary shows', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, operationsList)));
    const page = await operationsApi.list('token');
    expect(Number(page.total)).toBeGreaterThan(0);
  });

  describe('file uploads (multipart over XMLHttpRequest, see lib/api/upload)', () => {
    const files = () => (jest.requireMock('expo-file-system') as { __files: Set<string> }).__files;

    beforeEach(() => {
      FakeXhr.install();
      FakeXhr.reset();
      for (const uri of ['file:///r.jpg', 'file:///rc.jpg', 'file:///doc.exe']) files().add(uri);
    });

    it('takes the file id from a real upload response', async () => {
      FakeXhr.reset([{ status: 201, body: receiptUpload }]);
      await expect(uploadReceipt('token', { uri: 'file:///r.jpg', mimeType: 'image/jpeg', name: 'r.jpg' })).resolves.toBe(receiptUpload.fileId);
    });

    it('uploads document file, normalizes mime type, and reports progress fractionally', async () => {
      const progressUpdates: number[] = [];
      FakeXhr.reset([{ status: 201, body: { fileId: 'doc-file-123' } }]);
      const fileId = await uploadDocumentFile('token', { uri: 'file:///rc.jpg', mimeType: 'image/jpg', name: 'rc.jpg' }, (p) => progressUpdates.push(p));
      expect(fileId).toBe('doc-file-123');
      expect(FakeXhr.requests[0]?.form._parts[0]?.[1]).toMatchObject({ type: 'image/jpeg' });
      expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1);
    });

    it('rejects document upload with backend error message on server failure', async () => {
      FakeXhr.reset([{ status: 400, body: { error: { message: 'Invalid file format.' } } }]);
      await expect(
        uploadDocumentFile('token', { uri: 'file:///doc.exe', mimeType: 'application/octet-stream', name: 'doc.exe' }, () => {}),
      ).rejects.toThrow('Invalid file format.');
    });
  });

  it('maps the real error envelope onto the message and reference the driver sees', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(400, errorValidation)));
    const error = (await apiRequest('/fuel/mine', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('validation');
    expect(error.message).toBe(errorValidation.error.message);
    expect(error.requestId).toBe(errorValidation.error.requestId);
  });

  it('reads the real document matrix the Documents tab renders', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, documentsMine)));
    const result = await documentsApi.mine('token');

    expect(result.vehicle?.documents.map((item) => item.type)).toEqual(['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE']);
    const missing = result.vehicle?.documents.find((item) => !item.document);
    expect(missing?.status).toBe('NOT_UPLOADED');
    const present = result.vehicle?.documents.find((item) => item.document);
    expect(['PENDING', 'VERIFIED', 'REJECTED']).toContain(present?.document?.verificationStatus);
    expect(result.personal[0]?.type).toBe('DRIVING_LICENCE');
  });

  it('reads the real /payments/mine response: a received payment with its UTR, and no provider internals', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, paymentsMine)));
    const result = await paymentsApi.mine('token');

    const received = result.data.find((p) => p.status === 'PAID');
    expect(received && driverPaymentState(received.status)).toBe('received');
    expect(received && rupees(received.amount)).toBe('₹1,250.50');
    expect(received?.utr).toBe('CASH-042');
    const pending = result.data.find((p) => p.status === 'PENDING_APPROVAL');
    expect(pending && driverPaymentState(pending.status)).toBe('pending');
    expect(pending?.utr).toBeNull();
    expect(JSON.stringify(paymentsMine)).not.toMatch(/providerReference|idempotency|fundAccount/i);
  });
});
