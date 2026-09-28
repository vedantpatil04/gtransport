import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../api/client';
import { fuelApi, operationsApi, uploadReceipt } from '../api/operations';
import { useSession } from '../auth/session-store';
import { offlineQueue } from '../offline/queue';
import {
  classifyFailure, discardEntry, registerDailyHandlers, submitFuel, submitOperation, toPendingEntry,
} from '../../features/daily/submissions';

jest.mock('../api/operations', () => ({
  fuelApi: { create: jest.fn(), list: jest.fn(), get: jest.fn(), stations: jest.fn() },
  operationsApi: { create: jest.fn(), createTyreInsurance: jest.fn(), list: jest.fn() },
  uploadReceipt: jest.fn(),
  receiptSource: jest.fn(),
}));

const api = { fuel: fuelApi as jest.Mocked<typeof fuelApi>, ops: operationsApi as jest.Mocked<typeof operationsApi>, upload: uploadReceipt as jest.Mock };

const fuelBody = (id: string) => ({
  fuelType: 'DIESEL' as const,
  amount: 2450,
  litres: 25,
  fuelStation: 'IndianOil',
  transactionDate: '2026-09-19',
  clientSubmissionId: id,
});

describe('daily update submission', () => {
  beforeAll(() => registerDailyHandlers());

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    useSession.setState({ token: 'token-1', status: 'signedIn' });
  });

  it('sends a fuel entry straight away when online and reports it synced', async () => {
    api.fuel.create.mockResolvedValue({} as never);

    await expect(submitFuel(fuelBody('s-1'), null)).resolves.toBe('synced');
    expect(api.fuel.create).toHaveBeenCalledWith('token-1', expect.objectContaining({ clientSubmissionId: 's-1', amount: 2450 }));
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });

  it('keeps an entry as PENDING_SYNC when offline, then syncs it when the connection returns', async () => {
    api.fuel.create.mockRejectedValueOnce(new ApiError('network', 0, 'offline'));

    await expect(submitFuel(fuelBody('s-2'), null)).resolves.toBe('pending');
    const [pending] = await offlineQueue.list();
    expect(toPendingEntry(pending!)).toMatchObject({ state: 'PENDING_SYNC', amount: 2450, label: 'IndianOil' });

    // Connection restored.
    api.fuel.create.mockResolvedValueOnce({} as never);
    await offlineQueue.drain();

    await expect(offlineQueue.list()).resolves.toHaveLength(0);
    // Both attempts carried the same submission id, which is what lets the server store it once.
    expect(api.fuel.create.mock.calls.map((call) => call[1].clientSubmissionId)).toEqual(['s-2', 's-2']);
  });

  it('refuses a double tap of the same form without calling the server twice', async () => {
    api.fuel.create.mockRejectedValueOnce(new ApiError('network', 0, 'offline'));
    await submitFuel(fuelBody('s-3'), null);

    await expect(submitFuel(fuelBody('s-3'), null)).resolves.toBe('duplicate');
    await expect(offlineQueue.list()).resolves.toHaveLength(1);
  });

  it('uploads the receipt, attaches it, then removes the kept copy', async () => {
    const fs = jest.requireMock('expo-file-system') as { __files: Set<string> };
    fs.__files.add('file:///documents/pending-receipts/r1.jpg');
    api.upload.mockResolvedValue('file-123');
    api.fuel.create.mockResolvedValue({} as never);

    const receipt = { uri: 'file:///documents/pending-receipts/r1.jpg', mimeType: 'image/jpeg', name: 'r1.jpg' };
    await expect(submitFuel(fuelBody('s-4'), receipt)).resolves.toBe('synced');

    expect(api.upload).toHaveBeenCalledWith('token-1', receipt);
    expect(api.fuel.create).toHaveBeenCalledWith('token-1', expect.objectContaining({ receiptFileId: 'file-123' }));
    expect(fs.__files.has(receipt.uri)).toBe(false);
  });

  it('keeps the receipt on the phone when the upload fails, so nothing is lost', async () => {
    const fs = jest.requireMock('expo-file-system') as { __files: Set<string> };
    fs.__files.add('file:///documents/pending-receipts/r2.jpg');
    api.upload.mockRejectedValueOnce(new ApiError('timeout', 0, 'slow network'));

    const receipt = { uri: 'file:///documents/pending-receipts/r2.jpg', mimeType: 'image/jpeg', name: 'r2.jpg' };
    await expect(submitFuel(fuelBody('s-5'), receipt)).resolves.toBe('pending');

    expect(api.fuel.create).not.toHaveBeenCalled();
    expect(fs.__files.has(receipt.uri)).toBe(true);
  });

  it('marks an entry the server will never accept as rejected, and keeps it for the driver', async () => {
    api.ops.create.mockRejectedValueOnce(new ApiError('validation', 400, 'No vehicle is assigned to you.'));

    const outcome = await submitOperation(
      { category: 'RTO', amount: 500, expenseDate: '2026-09-19', clientSubmissionId: 's-6' },
      null,
    );
    expect(outcome).toBe('rejected');

    const [item] = await offlineQueue.list();
    expect(toPendingEntry(item!)).toMatchObject({ state: 'REJECTED', reason: 'No vehicle is assigned to you.' });

    await discardEntry(item!.id);
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });

  it('waits rather than failing when the driver has been signed out', async () => {
    useSession.setState({ token: null });

    await expect(submitFuel(fuelBody('s-7'), null)).resolves.toBe('pending');
    const [item] = await offlineQueue.list();
    expect(item).toMatchObject({ status: 'pending', attempts: 0 });
    expect(api.fuel.create).not.toHaveBeenCalled();
  });
});

describe('failure classification', () => {
  it.each([
    ['network', 'retry'],
    ['timeout', 'retry'],
    ['server', 'retry'],
    ['unauthorized', 'halt'],
    ['validation', 'permanent'],
    ['forbidden', 'permanent'],
    ['notFound', 'permanent'],
  ] as const)('treats %s as %s', (kind, expected) => {
    expect(classifyFailure(new ApiError(kind, 0, 'x'))).toBe(expected);
  });

  it('treats an unknown error as temporary, so nothing is dropped', () => {
    expect(classifyFailure(new Error('surprise'))).toBe('retry');
  });
});
