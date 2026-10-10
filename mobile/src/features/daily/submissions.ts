import { ApiError } from '../../lib/api/client';
import { fuelApi, operationsApi, uploadReceipt, type FuelPayload, type OperationPayload, type TyreInsurancePayload } from '../../lib/api/operations';
import { useSession } from '../../lib/auth/session-store';
import { offlineQueue, type FailureKind, type QueuedAction } from '../../lib/offline/queue';
import { requestSync } from '../../lib/offline/sync';
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
 *   PENDING_SYNC ──(connection returns, app reopened, signed in again, or its retry time comes)──▶ sent again
 *
 * What the driver sees: Syncing (being sent now), Waiting to sync (will retry by itself, with the
 * reason it last failed), Failed (needs them: retry or discard). Synced entries simply leave the
 * list — they are in the history from the server. Nothing is ever dropped to clear a warning.
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
    // 'file': the receipt photo is gone from the phone — waiting will not bring it back.
    if (error.kind === 'validation' || error.kind === 'forbidden' || error.kind === 'notFound' || error.kind === 'file') return 'permanent';
  }
  return 'retry';
}

/**
 * Of the temporary failures: does it say the whole network (or the service) is out, so the rest of
 * the queue would only fail the same way and waste a minute each? Or is it about this one entry — a
 * server error on its payload, a bug — in which case the entries behind it should still go.
 */
export function stopsPass(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === 'network' || error.kind === 'timeout') return true;
  return error.kind === 'server' && (error.status === 502 || error.status === 503 || error.status === 504);
}

/** What is stored about a failure: the message and the API's request reference (for the office to look up). */
function describeFailure(error: unknown): { message?: string; requestId?: string; kind?: string } {
  if (error instanceof ApiError) return { message: error.message, requestId: error.requestId, kind: error.kind };
  return { message: error instanceof Error ? error.message : undefined };
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
  offlineQueue.setStopsPass(stopsPass);
  offlineQueue.setDescriber(describeFailure);
  // Entries belong to the driver who made them: a different sign-in on the same phone never sends them.
  offlineQueue.setOwnerResolver(() => useSession.getState().user?.id);

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
  /** SYNCING: being sent now. PENDING_SYNC: will retry by itself. REJECTED: failed, needs the driver. */
  state: 'PENDING_SYNC' | 'SYNCING' | 'REJECTED';
  amount: number;
  date: string;
  label: string;
  /** Why it last failed, if it has. */
  reason?: string;
  /** API reference of the last failure; shown so the office can find it in the server log. */
  reference?: string;
  /** How many times it has been tried. */
  attempts: number;
  /** Failed because its receipt photo is no longer on the phone: the driver may send it without the photo. */
  canSendWithoutPhoto: boolean;
}

export function toPendingEntry(item: QueuedAction, activeId: string | null = null): PendingEntry | null {
  const state: PendingEntry['state'] = item.status === 'rejected' ? 'REJECTED' : item.id === activeId ? 'SYNCING' : 'PENDING_SYNC';
  const photoGone = item.status === 'rejected' && item.lastErrorKind === 'file' && Boolean((item.payload as { receipt?: LocalReceipt | null }).receipt);
  const common = {
    id: item.id,
    state,
    reason: item.lastError,
    reference: item.lastRequestId?.slice(0, 8),
    attempts: item.attempts,
    canSendWithoutPhoto: photoGone,
  };
  if (item.kind === KIND.fuel) {
    const { body } = item.payload as FuelItem;
    return { ...common, kind: KIND.fuel, amount: body.amount, date: body.transactionDate, label: body.fuelStation };
  }
  if (item.kind === KIND.operation) {
    const { body } = item.payload as OperationItem;
    return { ...common, kind: KIND.operation, amount: body.amount, date: body.expenseDate, label: body.category };
  }
  if (item.kind === KIND.tyreInsurance) {
    const { body } = item.payload as TyreInsuranceItem;
    return { ...common, kind: KIND.tyreInsurance, amount: body.premium ?? 0, date: body.expiryDate, label: body.insurer };
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

/** The driver tapped Retry on a failed entry: back in line, and tried now. */
export async function retryEntry(id: string): Promise<void> {
  await offlineQueue.requeue(id);
  await requestSync('manual');
}

/**
 * The receipt photo is gone from the phone and the driver chose to send the entry without it. Only the
 * photo is dropped — amount, date, station, category and the submission id stay exactly as entered, so
 * the server still recognises it as the same entry and stores it once.
 */
export async function sendWithoutPhoto(id: string): Promise<void> {
  await offlineQueue.updatePayload<{ receipt?: LocalReceipt | null }>(id, (payload) => ({ ...payload, receipt: null }));
  await retryEntry(id);
}
