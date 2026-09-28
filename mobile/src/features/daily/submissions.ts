import { ApiError } from '../../lib/api/client';
import { fuelApi, operationsApi, uploadReceipt, type FuelPayload, type OperationPayload, type TyreInsurancePayload } from '../../lib/api/operations';
import { useSession } from '../../lib/auth/session-store';
import { offlineQueue, type FailureKind, type QueuedAction } from '../../lib/offline/queue';
import { discardReceipt, type LocalReceipt } from '../../lib/receipts/storage';

/**
 * Offline-safe submission of daily updates.
 *
 * Every entry is written to the device's queue before any network call, so it exists even if
 * the phone loses signal, the app is closed, or the server is down. It is then sent; whatever
 * happens next, the driver's data is not lost:
 *
 *   saved on phone ──send──▶ server accepts ──▶ SYNCED (removed from the queue)
 *        │                      │
 *        │ no signal            └ refuses for good ──▶ REJECTED (kept, shown to the driver)
 *        ▼
 *   PENDING_SYNC ──(connection returns)──▶ sent again
 *
 * The clientSubmissionId is created once per form, so a double tap or an automatic retry
 * reaches the server as the same submission, and the server stores it exactly once.
 */

export const KIND = {
  fuel: 'fuel.create',
  operation: 'operation.create',
  tyreInsurance: 'tyreInsurance.create',
} as const;

type Kind = (typeof KIND)[keyof typeof KIND];

interface FuelItem {
  body: FuelPayload;
  receipt: LocalReceipt | null;
}
interface OperationItem {
  body: OperationPayload;
  receipt: LocalReceipt | null;
}
interface TyreInsuranceItem {
  body: TyreInsurancePayload;
  receipt: LocalReceipt | null;
}

export type SubmitOutcome = 'synced' | 'pending' | 'rejected' | 'duplicate';

/** Signals that the queue must pause without counting an attempt (no session). */
class SessionMissingError extends Error {
  constructor() {
    super('Not signed in');
  }
}

/**
 * Temporary problems are retried for as long as it takes; problems the server will never
 * accept are kept and shown; a missing or expired session pauses the queue.
 */
export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof SessionMissingError) return 'halt';
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') return 'halt';
    if (error.kind === 'validation' || error.kind === 'forbidden' || error.kind === 'notFound') return 'permanent';
  }
  return 'retry';
}

function token(): string {
  const value = useSession.getState().token;
  if (!value) throw new SessionMissingError();
  return value;
}

/** Uploads the kept receipt (if any) and returns its server id. Identical bytes de-duplicate. */
async function receiptIdFor(accessToken: string, receipt: LocalReceipt | null): Promise<string | undefined> {
  if (!receipt) return undefined;
  return uploadReceipt(accessToken, receipt);
}

let registered = false;

/** Wires the queue to the API. Called once when the app starts. */
export function registerDailyHandlers(): void {
  if (registered) return;
  registered = true;

  offlineQueue.setClassifier(classifyFailure);

  offlineQueue.register(KIND.fuel, async (payload) => {
    const item = payload as FuelItem;
    const accessToken = token();
    const receiptFileId = await receiptIdFor(accessToken, item.receipt);
    await fuelApi.create(accessToken, { ...item.body, ...(receiptFileId ? { receiptFileId } : {}) });
    discardReceipt(item.receipt?.uri);
  });

  offlineQueue.register(KIND.operation, async (payload) => {
    const item = payload as OperationItem;
    const accessToken = token();
    const receiptFileId = await receiptIdFor(accessToken, item.receipt);
    await operationsApi.create(accessToken, { ...item.body, ...(receiptFileId ? { receiptFileId } : {}) });
    discardReceipt(item.receipt?.uri);
  });

  offlineQueue.register(KIND.tyreInsurance, async (payload) => {
    const item = payload as TyreInsuranceItem;
    const accessToken = token();
    const receiptFileId = await receiptIdFor(accessToken, item.receipt);
    await operationsApi.createTyreInsurance(accessToken, { ...item.body, ...(receiptFileId ? { receiptFileId } : {}) });
    discardReceipt(item.receipt?.uri);
  });
}

/** Queues the entry, then tries to send it straight away. */
async function submit(kind: Kind, dedupeKey: string, payload: FuelItem | OperationItem | TyreInsuranceItem): Promise<SubmitOutcome> {
  const queued = await offlineQueue.enqueue({ kind, payload, dedupeKey });
  if (queued === 'duplicate') return 'duplicate';

  await offlineQueue.drain();

  const remaining = (await offlineQueue.list()).find((item) => item.dedupeKey === dedupeKey);
  if (!remaining) return 'synced';
  return remaining.status === 'rejected' ? 'rejected' : 'pending';
}

export const submitFuel = (body: FuelPayload, receipt: LocalReceipt | null) =>
  submit(KIND.fuel, body.clientSubmissionId, { body, receipt });

export const submitOperation = (body: OperationPayload, receipt: LocalReceipt | null) =>
  submit(KIND.operation, body.clientSubmissionId, { body, receipt });

export const submitTyreInsurance = (body: TyreInsurancePayload, receipt: LocalReceipt | null) =>
  submit(KIND.tyreInsurance, body.clientSubmissionId, { body, receipt });

/** What the driver sees for an entry still on the phone. */
export interface PendingEntry {
  id: string;
  kind: Kind;
  state: 'PENDING_SYNC' | 'REJECTED';
  amount: number;
  date: string;
  label: string;
  reason?: string;
}

export function toPendingEntry(item: QueuedAction): PendingEntry | null {
  const state = item.status === 'rejected' ? 'REJECTED' : 'PENDING_SYNC';
  if (item.kind === KIND.fuel) {
    const { body } = item.payload as FuelItem;
    return { id: item.id, kind: KIND.fuel, state, amount: body.amount, date: body.transactionDate, label: body.fuelStation, reason: item.lastError };
  }
  if (item.kind === KIND.operation) {
    const { body } = item.payload as OperationItem;
    return { id: item.id, kind: KIND.operation, state, amount: body.amount, date: body.expenseDate, label: body.category, reason: item.lastError };
  }
  if (item.kind === KIND.tyreInsurance) {
    const { body } = item.payload as TyreInsuranceItem;
    return { id: item.id, kind: KIND.tyreInsurance, state, amount: body.premium ?? 0, date: body.expiryDate, label: body.insurer, reason: item.lastError };
  }
  return null;
}

/** Removes a rejected entry the driver has decided to discard, along with its kept photo. */
export async function discardEntry(id: string): Promise<void> {
  const item = (await offlineQueue.list()).find((candidate) => candidate.id === id);
  const receipt = (item?.payload as { receipt?: LocalReceipt | null } | undefined)?.receipt;
  discardReceipt(receipt?.uri);
  await offlineQueue.remove(id);
}
