import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../api/client';
import { fuelApi, operationsApi, uploadReceipt } from '../api/operations';
import { useSession } from '../auth/session-store';
import { offlineQueue } from '../offline/queue';
import {
  classifyFailure, registerDailyHandlers, retryEntry, sendWithoutPhoto, stopsPass, submitFuel, submitOperation, toPendingEntry,
} from '../../features/daily/submissions';

jest.mock('../api/operations', () => ({
  fuelApi: { create: jest.fn(), list: jest.fn(), get: jest.fn(), stations: jest.fn() },
  operationsApi: { create: jest.fn(), createTyreInsurance: jest.fn(), list: jest.fn() },
  uploadReceipt: jest.fn(),
  receiptSource: jest.fn(),
}));

const fuel = fuelApi as jest.Mocked<typeof fuelApi>;
const ops = operationsApi as jest.Mocked<typeof operationsApi>;
const upload = uploadReceipt as jest.Mock;
const files = () => (jest.requireMock('expo-file-system') as { __files: Set<string> }).__files;

const operationBody = (id: string, amount = 10_000, date = '2026-10-06') => ({
  category: 'RTO' as const,
  amount,
  expenseDate: date,
  clientSubmissionId: id,
});
const receipt = (name: string) => ({ uri: `file:///documents/pending-receipts/${name}`, mimeType: 'image/jpeg', name });
const offline = () => new ApiError('network', 0, 'Unable to connect right now.');

describe('recovering entries that are waiting to sync', () => {
  beforeAll(() => registerDailyHandlers());

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    files().clear();
    useSession.setState({ token: 'token-1', status: 'signedIn', user: { id: 'driver-1' } as never });
  });

  it('sends five entries that piled up while the network was down — each once, with its original contents and submission id', async () => {
    const entries = [
      ['s-1', 10_000, '2026-09-27'],
      ['s-2', 10_000, '2026-10-06'],
      ['s-3', 25_000, '2026-10-07'],
      ['s-4', 10_000, '2026-10-07'],
      ['s-5', 10_000, '2026-10-08'],
    ] as const;
    files().add(receipt('r-1.jpg').uri);
    files().add(receipt('r-3.jpg').uri);
    ops.create.mockRejectedValue(offline());
    upload.mockResolvedValue('file-from-upload');

    for (const [id, amount, date] of entries) {
      const withReceipt = id === 's-1' ? receipt('r-1.jpg') : id === 's-3' ? receipt('r-3.jpg') : null;
      await expect(submitOperation(operationBody(id, amount, date), withReceipt)).resolves.toBe('pending');
    }
    expect(await offlineQueue.list()).toHaveLength(5);

    // The connection comes back.
    ops.create.mockReset();
    ops.create.mockResolvedValue({} as never);
    await offlineQueue.drain();

    await expect(offlineQueue.list()).resolves.toHaveLength(0);
    const sent = ops.create.mock.calls.map((call) => call[1]);
    expect(sent.map((body) => body.clientSubmissionId)).toEqual(['s-1', 's-2', 's-3', 's-4', 's-5']);
    expect(sent.map((body) => [body.amount, body.expenseDate])).toEqual([
      [10_000, '2026-09-27'],
      [10_000, '2026-10-06'],
      [25_000, '2026-10-07'],
      [10_000, '2026-10-07'],
      [10_000, '2026-10-08'],
    ]);
    expect(sent[0]).toMatchObject({ receiptFileId: 'file-from-upload' });
    expect(sent[1]).not.toHaveProperty('receiptFileId');

    // Draining again finds nothing to send, so nothing can be created twice.
    ops.create.mockClear();
    await offlineQueue.drain();
    expect(ops.create).not.toHaveBeenCalled();
  });

  it('a receipt that is gone from the phone fails that one entry — visibly — and does not hold up the entries behind it', async () => {
    // The photo was cleared from the cache: nothing on the phone to upload.
    upload.mockRejectedValue(new ApiError('file', 0, 'The photo or file is no longer on this phone.'));
    ops.create.mockResolvedValue({} as never);

    await expect(submitOperation(operationBody('lost-photo'), receipt('gone.jpg'))).resolves.toBe('rejected');
    for (const id of ['b-1', 'b-2', 'b-3', 'b-4']) await expect(submitOperation(operationBody(id), null)).resolves.toBe('synced');

    const [stuck] = await offlineQueue.list();
    expect(stuck).toMatchObject({ dedupeKey: 'lost-photo', status: 'rejected', lastError: 'The photo or file is no longer on this phone.' });
    expect(toPendingEntry(stuck!)).toMatchObject({ state: 'REJECTED', amount: 10_000, reason: 'The photo or file is no longer on this phone.' });
    expect(ops.create.mock.calls.map((call) => call[1].clientSubmissionId)).toEqual(['b-1', 'b-2', 'b-3', 'b-4']);
  });

  it('a server error on one entry is kept for retry, with the reason and reference, and does not stop the others', async () => {
    ops.create.mockImplementation(async (_token, body) => {
      if (body.clientSubmissionId === 'poisoned') throw new ApiError('server', 500, 'An unexpected error occurred.', 'INTERNAL_ERROR', 'cf871239-42c5-4782');
      return {} as never;
    });

    await submitOperation(operationBody('poisoned'), null);
    await expect(submitOperation(operationBody('fine'), null)).resolves.toBe('synced');

    const [kept] = await offlineQueue.list();
    expect(kept).toMatchObject({ dedupeKey: 'poisoned', status: 'failed', attempts: expect.any(Number), lastRequestId: 'cf871239-42c5-4782' });
    expect(kept!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(toPendingEntry(kept!)).toMatchObject({ state: 'PENDING_SYNC', reason: 'An unexpected error occurred.', reference: 'cf871239' });
  });

  it('stops the pass when the service itself is unavailable, instead of spending a minute per entry', async () => {
    ops.create.mockRejectedValue(new ApiError('server', 503, 'Service unavailable'));
    await submitOperation(operationBody('a'), null);
    await submitOperation(operationBody('b'), null);
    await submitOperation(operationBody('c'), null);
    ops.create.mockClear();

    await offlineQueue.drain();
    expect(ops.create).toHaveBeenCalledTimes(1);
  });

  it('a lost response is harmless: the retry carries the same submission id, so the server can recognise it', async () => {
    // The server saved the entry but the phone never heard back (a timeout while the instance woke up).
    ops.create.mockRejectedValueOnce(new ApiError('timeout', 0, 'The server is taking too long to respond.'));
    await expect(submitOperation(operationBody('same-entry'), null)).resolves.toBe('pending');

    ops.create.mockResolvedValueOnce({} as never);
    await offlineQueue.drain();

    await expect(offlineQueue.list()).resolves.toHaveLength(0);
    expect(ops.create.mock.calls.map((call) => call[1].clientSubmissionId)).toEqual(['same-entry', 'same-entry']);
  });

  it('keeps every entry when the session has expired, and sends them after signing in again', async () => {
    ops.create.mockRejectedValue(offline());
    await submitOperation(operationBody('e-1'), null);
    await submitOperation(operationBody('e-2'), null);

    const attemptsBefore = (await offlineQueue.list()).map((entry) => entry.attempts);
    ops.create.mockReset();
    ops.create.mockRejectedValue(new ApiError('unauthorized', 401, 'Your session has ended.'));
    await offlineQueue.drain();
    expect(ops.create).toHaveBeenCalledTimes(1);
    // The pass paused: nothing was spent, nothing was dropped, nothing was marked failed for good.
    const afterExpiry = await offlineQueue.list();
    expect(afterExpiry.map((entry) => entry.attempts)).toEqual(attemptsBefore);
    expect(afterExpiry.map((entry) => entry.dedupeKey)).toEqual(['e-1', 'e-2']);
    expect(afterExpiry.every((entry) => entry.status !== 'rejected')).toBe(true);

    // Signed out, then in again.
    useSession.setState({ token: null, status: 'signedOut' });
    await offlineQueue.drain();
    expect(await offlineQueue.list()).toHaveLength(2);

    useSession.setState({ token: 'token-2', status: 'signedIn' });
    ops.create.mockReset();
    ops.create.mockResolvedValue({} as never);
    await offlineQueue.drain();
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
    expect(ops.create.mock.calls.map((call) => call[0])).toEqual(['token-2', 'token-2']);
  });

  it('lets the driver retry a failed entry once the cause is fixed — same submission id, nothing duplicated', async () => {
    ops.create.mockRejectedValueOnce(new ApiError('validation', 400, 'No vehicle is assigned to you.', 'BAD_REQUEST', 'req-12345678'));
    await expect(submitOperation(operationBody('needs-vehicle'), null)).resolves.toBe('rejected');
    const [failed] = await offlineQueue.list();
    expect(toPendingEntry(failed!)).toMatchObject({ state: 'REJECTED', reason: 'No vehicle is assigned to you.', reference: 'req-1234' });

    // The office assigned a vehicle.
    ops.create.mockResolvedValueOnce({} as never);
    await retryEntry(failed!.id);

    await expect(offlineQueue.list()).resolves.toHaveLength(0);
    expect(ops.create.mock.calls.map((call) => call[1].clientSubmissionId)).toEqual(['needs-vehicle', 'needs-vehicle']);
  });

  it('shows Syncing only for the entry being sent', async () => {
    ops.create.mockRejectedValue(offline());
    await submitOperation(operationBody('x'), null);
    const [item] = await offlineQueue.list();

    expect(toPendingEntry(item!)).toMatchObject({ state: 'PENDING_SYNC' });
    expect(toPendingEntry(item!, item!.id)).toMatchObject({ state: 'SYNCING' });
    expect(toPendingEntry(item!, 'someone-else')).toMatchObject({ state: 'PENDING_SYNC' });
  });

  it('never shows another driver\'s entries or sends them under this driver\'s session', async () => {
    useSession.setState({ user: { id: 'driver-a' } as never });
    ops.create.mockRejectedValue(offline());
    await submitOperation(operationBody('a-only'), null);

    useSession.setState({ user: { id: 'driver-b' } as never, token: 'token-b' });
    ops.create.mockReset();
    ops.create.mockResolvedValue({} as never);
    await submitOperation(operationBody('b-only'), null);

    expect(ops.create.mock.calls.map((call) => call[1].clientSubmissionId)).toEqual(['b-only']);
    expect((await offlineQueue.list()).map((entry) => entry.dedupeKey)).toEqual(['a-only']);
  });

  it('an entry whose photo is gone can be sent without it — same amount, date and submission id, stored once', async () => {
    upload.mockRejectedValue(new ApiError('file', 0, 'The photo or file is no longer on this phone.'));
    ops.create.mockResolvedValue({} as never);
    await expect(submitOperation(operationBody('photo-gone', 25_000, '2026-10-07'), receipt('gone.jpg'))).resolves.toBe('rejected');

    const [failed] = await offlineQueue.list();
    expect(toPendingEntry(failed!)).toMatchObject({ state: 'REJECTED', canSendWithoutPhoto: true });
    expect(ops.create).not.toHaveBeenCalled();

    await sendWithoutPhoto(failed!.id);

    await expect(offlineQueue.list()).resolves.toHaveLength(0);
    expect(ops.create).toHaveBeenCalledTimes(1);
    const sent = ops.create.mock.calls[0]![1];
    expect(sent).toMatchObject({ clientSubmissionId: 'photo-gone', amount: 25_000, expenseDate: '2026-10-07', category: 'RTO' });
    expect(sent).not.toHaveProperty('receiptFileId');
  });

  it('does not offer to drop the photo for an entry that failed for any other reason', async () => {
    upload.mockResolvedValue('file-uploaded');
    ops.create.mockRejectedValueOnce(new ApiError('validation', 400, 'No vehicle is assigned to you.'));
    await submitOperation(operationBody('other-failure'), receipt('still-here.jpg'));
    const [failed] = await offlineQueue.list();
    expect(toPendingEntry(failed!)).toMatchObject({ state: 'REJECTED', canSendWithoutPhoto: false });
  });

  it('keeps fuel entries on the same footing as other entries', async () => {
    fuel.create.mockRejectedValueOnce(offline());
    await expect(
      submitFuel({ fuelType: 'DIESEL', amount: 2450, litres: 25, fuelStation: 'IndianOil', transactionDate: '2026-10-08', clientSubmissionId: 'f-1' }, null),
    ).resolves.toBe('pending');
    fuel.create.mockResolvedValueOnce({} as never);
    await offlineQueue.drain();
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });
});

describe('failure rules', () => {
  it.each([
    ['network', 0, true],
    ['timeout', 0, true],
    ['server', 502, true],
    ['server', 503, true],
    ['server', 504, true],
    ['server', 500, false],
    ['validation', 400, false],
  ] as const)('%s (%s) stops the pass: %s', (kind, status, expected) => {
    expect(stopsPass(new ApiError(kind, status, 'x'))).toBe(expected);
  });

  it('treats a missing local file as something waiting cannot fix', () => {
    expect(classifyFailure(new ApiError('file', 0, 'gone'))).toBe('permanent');
  });
});
