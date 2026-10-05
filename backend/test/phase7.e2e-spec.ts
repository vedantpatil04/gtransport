import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { AI_PROVIDER } from '../src/modules/ai/ai.tokens';
import { EMAIL_PROVIDER } from '../src/modules/inbox/inbox.tokens';
import type { AIProvider } from '../src/modules/ai/provider';
import { AIProviderError } from '../src/modules/ai/provider';
import type { EmailProvider, EmailSyncPage, InboundEmail } from '../src/modules/inbox/email-provider';
import { EmailProviderError } from '../src/modules/inbox/email-provider';

/**
 * Phase 7: service receipt AI and email intelligence, end to end — the real HTTP stack, the real
 * guards, the real queue and a real PostgreSQL database.
 *
 * The providers are the one thing replaced, and only here. Reaching a real Ollama server or a real
 * company mailbox from a test suite is not possible, and §36 permits a double in automated tests
 * precisely so the *pipeline* can be exercised honestly: every job, every state transition, every
 * retry and every permission check below is the production code path. What the double stands in
 * for is the model's answer, not the machinery around it.
 *
 * The provider double is also how the failure modes get tested at all — a timeout, a malformed
 * response, a model that is not installed — none of which can be produced on demand from a real one.
 */

/**
 * A well-formed extraction, as a provider would return it.
 *
 * `vehicleNumber` is filled in once the company is seeded: the registration is generated per run,
 * and an extraction naming a different truck is — correctly — sent to review, which would make
 * every test here assert the wrong thing.
 */
const EXTRACTION = {
  vendorName: 'Sharma Auto Works',
  invoiceNumber: 'INV-2291',
  invoiceDate: '2026-03-04',
  vehicleNumber: 'KA 22 AB 1234',
  serviceType: 'Brake service',
  odometerKm: 48_200,
  nextServiceDate: null as string | null,
  nextServiceKm: 58_200,
  lineItems: [
    { description: 'Brake pad set', kind: 'PART', quantity: 1, unitPrice: 1700, amount: 1700 },
    { description: 'Brake overhaul labour', kind: 'LABOUR', quantity: 1, unitPrice: 500, amount: 500 },
  ],
  partsAmount: 1700,
  labourAmount: 500,
  gstAmount: 396,
  otherCharges: null,
  subtotal: 2200,
  totalAmount: 2596,
  confidence: 0.92,
  rawText: 'SHARMA AUTO WORKS ... TOTAL 2596.00',
  warnings: [],
};

/** Controlled from each test: what the provider does next. */
class ScriptedAIProvider implements AIProvider {
  readonly name = 'ollama' as const;
  readonly model = 'test-vision-model';
  next: (() => Promise<unknown>) | null = null;
  calls = 0;

  async processServiceReceipt(): Promise<unknown> {
    this.calls += 1;
    if (!this.next) return EXTRACTION;
    return this.next();
  }

  async processText(): Promise<unknown> {
    this.calls += 1;
    if (!this.next) return { classification: 'GENERAL', confidence: 0.7, summary: 'A routine message.', references: [], warnings: [] };
    return this.next();
  }
}

/** A mailbox whose contents each test sets. */
class ScriptedEmailProvider implements EmailProvider {
  readonly name = 'IMAP_MAILBOX' as const;
  readonly mailbox = 'INBOX';
  failWith: EmailProviderError | null = null;
  fetchCalls = 0;
  /** Attachment downloads that fail before one succeeds — a provider hiccup. */
  attachmentFailures = 0;

  private queue: InboundEmail[] = [];
  private served = 0;

  /**
   * Assigning new mail is what a test does to stand a fresh mailbox up, so the double's own
   * position resets with it. The stored cursor still governs whether mail already handed over is
   * offered again — which is how the overlapping-window case below is produced.
   */
  set messages(next: InboundEmail[]) {
    this.queue = next;
    this.served = 0;
  }

  get messages(): InboundEmail[] {
    return this.queue;
  }

  isConfigured(): boolean {
    return true;
  }

  async fetchSince(cursor: string | null, limit: number): Promise<EmailSyncPage> {
    this.fetchCalls += 1;
    if (this.failWith) throw this.failWith;
    // A null cursor means the server was asked to start again, so everything is offered afresh.
    const after = cursor === null ? 0 : this.served;
    const slice = this.queue.slice(after, after + limit);
    this.served = after + slice.length;
    // Pages, as the real providers deliver them: more is waiting until the queue is exhausted.
    return { messages: slice, nextCursor: String(this.served), hasMore: this.served < this.queue.length };
  }

  async fetchAttachment(): Promise<Uint8Array> {
    if (this.attachmentFailures > 0) {
      this.attachmentFailures -= 1;
      throw new EmailProviderError('The attachment download timed out.', 'TIMEOUT', true);
    }
    return new Uint8Array([37, 80, 68, 70]);
  }

  async verifyConnection() {
    return { ok: true as const, mailbox: 'INBOX', messageCount: this.messages.length };
  }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Phase 7: service AI & email intelligence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: typeof import('./app-fixture');
  let seed: Awaited<ReturnType<typeof import('./app-fixture')['seedCompany']>>;
  let admin: string;
  let driver: string;
  let accounting: string;
  let ai: ScriptedAIProvider;
  let mailbox: ScriptedEmailProvider;

  const api = () => request(app.getHttpServer());
  const V = '/api/v1';
  const login = async (identifier: string) =>
    (await api().post(`${V}/auth/login`).send({ identifier, password: fixture.TEST_PASSWORD }).expect(200)).body.accessToken as string;
  const as = (token: string) => ({
    get: (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => api().post(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => api().patch(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** Uploads a receipt photo and files a maintenance expense against it, as the driver app does. */
  const uploadServiceReceipt = async (overrides: Record<string, unknown> = {}) => {
    const upload = await api()
      .post(`${V}/files/receipts`)
      .set('Authorization', `Bearer ${driver}`)
      .attach('file', PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(201);

    const created = await as(driver).post('/operations/mine', {
      category: 'MAINTENANCE',
      amount: '2596.00',
      expenseDate: new Date().toISOString().slice(0, 10),
      vendorName: 'Sharma Auto Works',
      receiptFileId: upload.body.fileId,
      clientSubmissionId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    });
    expect([200, 201]).toContain(created.status);
    return { expenseId: created.body.id as string, fileId: upload.body.fileId as string };
  };

  /** Runs the worker until the queue is empty, exactly as the dispatcher does in production. */
  /**
   * Runs the worker until the queue is empty, exactly as the dispatcher does in production.
   *
   * Drained to exhaustion rather than for a fixed number of jobs: the queue is company-wide and
   * the test database is not emptied between runs, so a fixed budget can be spent entirely on
   * another run's leftovers and this test's own job never gets picked up.
   */
  const drainQueue = async (): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ReceiptWorkerService } = require('../src/modules/ai/receipts/receipt-worker.service');
    const worker = app.get(ReceiptWorkerService);
    let total = 0;
    for (let pass = 0; pass < 20; pass += 1) {
      const processed = await worker.drain(10);
      total += processed;
      if (processed === 0) break;
    }
    return total;
  };

  const statusOf = async (expenseId: string) =>
    (await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId }, select: { aiStatus: true } })).aiStatus;

  beforeAll(async () => {
    Object.assign(process.env, {
      // The queue is drained explicitly in these tests, so the background timer stays out of it.
      AI_WORKER_ENABLED: 'false',
      EMAIL_SYNC_ENABLED: 'false',
      EMAIL_AI_ENABLED: 'true',
      AI_MAX_ATTEMPTS: '2',
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fixture = require('./app-fixture') as typeof import('./app-fixture');
    prisma = fixture.rawPrisma();

    ai = new ScriptedAIProvider();
    mailbox = new ScriptedEmailProvider();

    // The two external boundaries are the only things replaced; everything between the HTTP layer
    // and the database below is the production wiring.
    app = await fixture.createTestApp([
      { token: AI_PROVIDER, value: ai },
      { token: EMAIL_PROVIDER, value: mailbox },
    ]);

    seed = await fixture.seedCompany(prisma);
    // The registration is generated per run, so the canned extraction has to name it: a receipt
    // for a different truck is sent to review, which is exactly the check being relied on later.
    EXTRACTION.vehicleNumber = seed.vehicle.registrationNumber;
    admin = await login(seed.admin.identifier);
    driver = await login(seed.driver.identifier);

    const clerk = await prisma.employee.create({
      data: { companyId: seed.company.id, employeeCode: `ACC-${Date.now()}`, fullName: 'Accounts Clerk' },
    });
    const clerkUser = await prisma.user.create({
      data: {
        companyId: seed.company.id,
        employeeId: clerk.id,
        email: `acc-${Date.now()}@e2e.test`,
        role: 'ACCOUNTING',
        passwordHash: await new PasswordHasher().hash(fixture.TEST_PASSWORD),
      },
    });
    accounting = await login(clerkUser.email as string);
  });

  afterEach(() => {
    ai.next = null;
    mailbox.failWith = null;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  // ─────────────────────── Receipt: upload and processing ───────────────────────

  describe('a service receipt is read without anyone waiting', () => {
    it('stores the original, creates the record and queues a job — without calling a model', async () => {
      const before = ai.calls;
      const { expenseId, fileId } = await uploadServiceReceipt();

      // The upload returned before any model ran: that is what makes it usable on a forecourt.
      expect(ai.calls).toBe(before);
      expect(await statusOf(expenseId)).toBe('QUEUED');

      const job = await prisma.serviceReceiptAIJob.findFirstOrThrow({ where: { vehicleExpenseId: expenseId } });
      expect(job).toMatchObject({ status: 'QUEUED', attempt: 1, receiptFileId: fileId });

      const stored = await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
      expect(stored.deletedAt).toBeNull();
    });

    it('produces a versioned extraction and leaves the record for a person', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();

      const result = await prisma.serviceReceiptAIResult.findFirstOrThrow({ where: { vehicleExpenseId: expenseId } });
      expect(result).toMatchObject({ version: 1, provider: 'ollama', model: 'test-vision-model' });
      expect(Number(result.confidence)).toBeCloseTo(0.92, 2);

      // Processing finished; the record has not been accepted by anyone yet.
      expect(await statusOf(expenseId)).toBe('SUCCEEDED');
    });

    it('writes nothing from the extraction onto the maintenance record', async () => {
      const { expenseId } = await uploadServiceReceipt({ amount: '1000.00', vendorName: 'Typed By Driver' });
      ai.next = async () => ({ ...EXTRACTION, totalAmount: 9999, vendorName: 'From The Receipt' });
      await drainQueue();

      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      // The figures are still the ones a person entered. AI proposed; it did not decide.
      expect(expense.amount.toFixed(2)).toBe('1000.00');
      expect(expense.vendorName).toBe('Typed By Driver');
    });

    it('routes a low-confidence extraction to review rather than offering it as ready', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => ({ ...EXTRACTION, confidence: 0.25 });
      await drainQueue();

      expect(await statusOf(expenseId)).toBe('NEEDS_REVIEW');
    });

    it('routes a contradictory extraction to review however confident the model was', async () => {
      const { expenseId } = await uploadServiceReceipt();
      // A total that does not match its own components, reported with high confidence.
      ai.next = async () => ({ ...EXTRACTION, totalAmount: 90_000, confidence: 0.99 });
      await drainQueue();

      expect(await statusOf(expenseId)).toBe('NEEDS_REVIEW');
      const result = await prisma.serviceReceiptAIResult.findFirstOrThrow({
        where: { vehicleExpenseId: expenseId },
        orderBy: { version: 'desc' },
      });
      expect(result.validationIssues.length).toBeGreaterThan(0);
    });

    it('records missing values as missing, never as zero or today', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => ({ ...EXTRACTION, totalAmount: null, invoiceDate: null, vendorName: null });
      await drainQueue();

      const result = await prisma.serviceReceiptAIResult.findFirstOrThrow({
        where: { vehicleExpenseId: expenseId },
        orderBy: { version: 'desc' },
      });
      const extraction = result.extraction as Record<string, unknown>;
      expect(extraction.totalAmount).toBeNull();
      expect(extraction.invoiceDate).toBeNull();

      const review = await as(admin).get(`/service-receipts/${expenseId}`).expect(200);
      expect(review.body.suggestions.totalAmount).toEqual({ value: null, state: 'missing' });
    });
  });

  // ─────────────────────── Receipt: failure and retry ───────────────────────

  describe('when reading the receipt fails', () => {
    it('keeps the original and records an explicit failure', async () => {
      const { expenseId, fileId } = await uploadServiceReceipt();
      ai.next = async () => {
        throw new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      };
      await drainQueue();

      const job = await prisma.serviceReceiptAIJob.findFirstOrThrow({
        where: { vehicleExpenseId: expenseId, status: 'FAILED' },
      });
      expect(job.failureCode).toBe('PROVIDER_UNAVAILABLE');

      // The whole guarantee of §5: whatever happened, the receipt is still there.
      const stored = await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
      expect(stored.deletedAt).toBeNull();
      const review = await as(admin).get(`/service-receipts/${expenseId}`).expect(200);
      expect(review.body.receipt.fileId).toBe(fileId);
    });

    it('schedules another attempt for a transient failure', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => {
        throw new AIProviderError('Ollama request timed out.', 'PROVIDER_TIMEOUT', true);
      };
      await drainQueue();

      // A new job rather than a reset one, so what was attempted stays on the record.
      const retry = await prisma.serviceReceiptAIJob.findFirstOrThrow({
        where: { vehicleExpenseId: expenseId, status: 'RETRYING' },
      });
      expect(retry.attempt).toBe(2);
      // AI_MAX_ATTEMPTS is recorded on the job, so the retry budget is the configured one.
      expect(retry.maxAttempts).toBe(2);
      expect(retry.nextAttemptAt).not.toBeNull();
      expect(await statusOf(expenseId)).toBe('RETRYING');
    });

    it('gives up after the configured number of attempts and leaves it for a person', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => {
        throw new AIProviderError('Ollama request timed out.', 'PROVIDER_TIMEOUT', true);
      };
      await drainQueue();
      // Bring the scheduled retry forward instead of waiting out the backoff.
      await prisma.serviceReceiptAIJob.updateMany({ where: { vehicleExpenseId: expenseId, status: 'RETRYING' }, data: { nextAttemptAt: new Date(0) } });
      await drainQueue();

      expect(await statusOf(expenseId)).toBe('FAILED');
      const jobs = await prisma.serviceReceiptAIJob.findMany({ where: { vehicleExpenseId: expenseId }, orderBy: { attempt: 'asc' } });
      expect(jobs.map((job) => [job.attempt, job.status])).toEqual([[1, 'FAILED'], [2, 'FAILED']]);
      const audit = await prisma.auditLog.count({ where: { action: 'service_receipt.ai_failed', entityId: expenseId } });
      expect(audit).toBe(2);
    });

    it('stops retrying a failure that retrying cannot fix', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => {
        throw new AIProviderError('The model is not installed.', 'CONFIGURATION_ERROR', false);
      };
      await drainQueue();

      expect(await statusOf(expenseId)).toBe('FAILED');
      expect(await prisma.serviceReceiptAIJob.count({ where: { vehicleExpenseId: expenseId, status: 'RETRYING' } })).toBe(0);
    });

    it('treats output that does not match the contract as a failure, not a partial result', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => ({ vendorName: 'Sharma', totalAmount: 'about two thousand' });
      await drainQueue();

      const job = await prisma.serviceReceiptAIJob.findFirstOrThrow({
        where: { vehicleExpenseId: expenseId, status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(job.failureCode).toBe('INVALID_AI_OUTPUT');
      // Nothing half-usable was stored.
      expect(await prisma.serviceReceiptAIResult.count({ where: { vehicleExpenseId: expenseId } })).toBe(0);
    });

    it('lets an administrator ask for another attempt', async () => {
      const { expenseId } = await uploadServiceReceipt();
      ai.next = async () => {
        throw new AIProviderError('Unavailable.', 'CONFIGURATION_ERROR', false);
      };
      await drainQueue();
      expect(await statusOf(expenseId)).toBe('FAILED');

      ai.next = null;
      await as(admin).post(`/service-receipts/${expenseId}/retry`).expect(202);
      expect(await statusOf(expenseId)).toBe('QUEUED');

      await drainQueue();
      expect(await statusOf(expenseId)).toBe('SUCCEEDED');
    });
  });

  // ─────────────────────── Receipt: verification ───────────────────────

  describe('verification is what makes a record authoritative', () => {
    it('writes the administrator\'s submitted values, and names who confirmed them', async () => {
      const { expenseId } = await uploadServiceReceipt({ amount: '1000.00' });
      await drainQueue();
      const result = await prisma.serviceReceiptAIResult.findFirstOrThrow({ where: { vehicleExpenseId: expenseId } });

      await as(admin)
        .post(`/service-receipts/${expenseId}/verify`, {
          amount: '2596.00',
          vendorName: 'Sharma Auto Works',
          acceptedFields: ['totalAmount', 'vendorName'],
          resultId: result.id,
        })
        .expect(200);

      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(expense.amount.toFixed(2)).toBe('2596.00');
      expect(expense.aiStatus).toBe('VERIFIED');
      expect(expense.aiVerifiedById).toBe(seed.admin.id);
      expect(expense.aiVerifiedAt).not.toBeNull();
      expect(expense.acceptedResultId).toBe(result.id);
      // Which values matched the extraction, worked out on the server rather than taken on trust.
      expect(expense.aiAcceptedFields).toEqual(expect.arrayContaining(['totalAmount', 'vendorName']));
    });

    it('saves a correction the administrator typed, not what the model suggested', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();

      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '3100.00', vendorName: 'Different Garage' }).expect(200);

      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(expense.amount.toFixed(2)).toBe('3100.00');
      expect(expense.vendorName).toBe('Different Garage');
      // Nothing was accepted from the extraction, and the record says so.
      expect(expense.aiAcceptedFields).toEqual([]);
    });

    it('records the verification in the audit trail with the acting user', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'service_receipt.verified', entityId: expenseId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(entry?.actorUserId).toBe(seed.admin.id);
    });

    it('does not mark a record verified merely because the model finished', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();

      // A successful, high-confidence extraction. Still not verified.
      expect(await statusOf(expenseId)).toBe('SUCCEEDED');
      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(expense.aiVerifiedAt).toBeNull();
    });

    it('verifies the structured service details a person checked, and records which were corrected', async () => {
      const { expenseId } = await uploadServiceReceipt({ amount: '2596.00' });
      ai.next = async () => ({ ...EXTRACTION, nextServiceDate: '2099-01-01' });
      await drainQueue();
      const result = await prisma.serviceReceiptAIResult.findFirstOrThrow({ where: { vehicleExpenseId: expenseId } });

      await as(admin)
        .post(`/service-receipts/${expenseId}/verify`, {
          amount: '2596.00',
          vendorName: 'Sharma Auto Works',
          invoiceNumber: 'INV-2291',
          serviceType: 'Brake service',
          // Corrected: the person read the odometer off the job card differently.
          odometerKm: 48_250,
          nextServiceDate: '2099-01-01',
          nextServiceKm: 58_200,
          labourAmount: '500.00',
          partsAmount: '1700.00',
          taxAmount: '396.00',
          lineItems: [
            { description: 'Brake pad set', kind: 'PART', quantity: '1', unitPrice: '1700.00', amount: '1700.00' },
            { description: 'Brake overhaul labour', kind: 'LABOUR', quantity: '1', unitPrice: '500.00', amount: '500.00' },
          ],
          resultId: result.id,
        })
        .expect(200);

      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(expense).toMatchObject({ aiStatus: 'VERIFIED', invoiceNumber: 'INV-2291', serviceType: 'Brake service', odometerKm: 48_250, nextServiceKm: 58_200 });
      expect(expense.nextServiceDate?.toISOString().slice(0, 10)).toBe('2099-01-01');
      expect(expense.taxAmount?.toFixed(2)).toBe('396.00');
      expect(expense.serviceLineItems).toHaveLength(2);
      expect(expense.aiAcceptedFields).toEqual(expect.arrayContaining(['totalAmount', 'invoiceNumber', 'nextServiceKm', 'lineItems']));
      expect(expense.aiAcceptedFields).not.toContain('odometerKm');

      const corrected = await prisma.auditLog.findFirstOrThrow({ where: { action: 'service_receipt.corrected', entityId: expenseId } });
      expect(corrected.actorUserId).toBe(seed.admin.id);
      expect(JSON.stringify(corrected.changes)).toContain('odometerKm');
    });

    it('moves the ledger with a verified amount, so finance never disagrees with the record', async () => {
      const { expenseId } = await uploadServiceReceipt({ amount: '1000.00' });
      await drainQueue();
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);

      const lines = await prisma.financeLedgerEntry.findMany({ where: { companyId: seed.company.id, sourceId: expenseId } });
      const net = lines.reduce((sum, line) => sum + Number(line.amount), 0);
      expect(net).toBeCloseTo(2596, 2);
    });

    it('refuses figures that cannot be right', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      const today = new Date().toISOString().slice(0, 10);
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { expenseDate: today, nextServiceDate: '2000-01-01' }).expect(400);
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { odometerKm: 50_000, nextServiceKm: 40_000 }).expect(400);
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { expenseDate: '2999-01-01' }).expect(400);
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { lineItems: [{ description: 'Pads', kind: 'GUESS' }] }).expect(400);
      expect(await statusOf(expenseId)).not.toBe('VERIFIED');
    });

    it('audits the upload and the processing of a receipt', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      const actions = (await prisma.auditLog.findMany({ where: { entityId: expenseId }, select: { action: true } })).map((e) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['service_receipt.uploaded', 'service_receipt.ai_processing', 'service_receipt.ai_completed']));
    });

    it('lets an administrator reject an unusable extraction without touching the record', async () => {
      const { expenseId } = await uploadServiceReceipt({ amount: '1500.00' });
      await drainQueue();

      await as(admin).post(`/service-receipts/${expenseId}/reject`, { reason: 'The photo is unreadable.' }).expect(200);

      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(expense.aiStatus).toBe('REJECTED');
      expect(expense.amount.toFixed(2)).toBe('1500.00');
      expect(expense.aiRejectedAt).not.toBeNull();
    });
  });

  // ─────────────────────── The core guarantee ───────────────────────

  describe('a later AI run cannot overwrite a verified record', () => {
    it('refuses to queue processing for a confirmed record', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);

      // The retry endpoint says no, with a reason, rather than silently doing nothing.
      const refused = await as(admin).post(`/service-receipts/${expenseId}/retry`).expect(400);
      expect(refused.body.error.message).toMatch(/settled|re-open/i);
    });

    it('leaves a confirmed record untouched when a queued job runs afterwards', async () => {
      const { expenseId, fileId } = await uploadServiceReceipt({ amount: '2596.00' });

      // A job is already queued when the office confirms the record by hand.
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);

      // The worker then picks that job up. It must abandon it rather than re-reading the receipt.
      ai.next = async () => ({ ...EXTRACTION, totalAmount: 77_777, confidence: 0.99 });
      const callsBefore = ai.calls;
      await drainQueue();

      expect(ai.calls).toBe(callsBefore);
      const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(expense.aiStatus).toBe('VERIFIED');
      expect(expense.amount.toFixed(2)).toBe('2596.00');
      // And the original is still where it was.
      expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } })).deletedAt).toBeNull();
    });

    it('keeps every extraction version when a record is re-opened and read again', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);

      // Re-opening is a deliberate, audited act that demands a reason.
      await as(admin).post(`/service-receipts/${expenseId}/reopen`, {}).expect(400);
      await as(admin).post(`/service-receipts/${expenseId}/reopen`, { reason: 'A better model is now configured.' }).expect(200);
      expect(await statusOf(expenseId)).toBe('NEEDS_REVIEW');

      ai.next = async () => ({ ...EXTRACTION, totalAmount: 2700, confidence: 0.95 });
      await as(admin).post(`/service-receipts/${expenseId}/retry`).expect(202);
      await drainQueue();

      const versions = await prisma.serviceReceiptAIResult.findMany({
        where: { vehicleExpenseId: expenseId },
        orderBy: { version: 'asc' },
      });
      // Version 1 survives. History is added to, never replaced (§29).
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      expect((versions[0]!.extraction as Record<string, unknown>).totalAmount).toBe(2596);
      expect((versions[1]!.extraction as Record<string, unknown>).totalAmount).toBe(2700);
    });

    it('records who re-opened a confirmed record, and why', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);
      await as(admin).post(`/service-receipts/${expenseId}/reopen`, { reason: 'Wrong invoice attached.' }).expect(200);

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'service_receipt.reopened', entityId: expenseId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(entry.actorUserId).toBe(seed.admin.id);
      expect(JSON.stringify(entry.metadata)).toContain('Wrong invoice attached.');
    });
  });

  // ─────────────────────── Receipt: RBAC and the driver's view ───────────────────────

  describe('who may do what', () => {
    it('refuses an unauthenticated caller', async () => {
      await api().get(`${V}/service-receipts/pending`).expect(401);
    });

    it('does not let a driver reach the office review screens', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await as(driver).get('/service-receipts/pending').expect(403);
      await as(driver).get(`/service-receipts/${expenseId}`).expect(403);
      await as(driver).post(`/service-receipts/${expenseId}/verify`, { amount: '1.00' }).expect(403);
      await as(driver).post(`/service-receipts/${expenseId}/retry`).expect(403);
    });

    it('shows a driver their own uploads as plain states, with no AI detail', async () => {
      await uploadServiceReceipt();
      const mine = await as(driver).get('/service-receipts/mine').expect(200);

      expect(mine.body.data.length).toBeGreaterThan(0);
      const row = mine.body.data[0];
      expect(['uploaded', 'processing', 'needsReview', 'verified', 'failed']).toContain(row.state);
      // A driver has no use for any of this and no way to act on it (§33).
      const serialised = JSON.stringify(mine.body);
      expect(serialised).not.toContain('confidence');
      expect(serialised).not.toContain('ollama');
      expect(serialised).not.toContain('test-vision-model');
      expect(serialised).not.toContain('NEEDS_REVIEW');
    });

    it('does not let an accounting user re-open a confirmed record', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      // Accounting may verify, because that is a financial figure they own.
      await as(accounting).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);
      // Undoing a confirmation is narrower: it belongs to the roles that run the fleet.
      await as(accounting).post(`/service-receipts/${expenseId}/reopen`, { reason: 'x' }).expect(403);
    });

    it('keeps the receipt contents out of the audit trail', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();

      const entries = await prisma.auditLog.findMany({
        where: { companyId: seed.company.id, entityId: expenseId },
      });
      const serialised = JSON.stringify(entries);
      expect(serialised).not.toContain('SHARMA AUTO WORKS ... TOTAL');
      expect(serialised).not.toContain(EXTRACTION.rawText);
    });
  });

  // ─────────────────────── Maintenance intelligence ───────────────────────

  describe('maintenance intelligence rests on verified records only', () => {
    it('counts nothing that has not been verified', async () => {
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();

      const before = await as(admin).get(`/service-receipts/maintenance/vehicles/${seed.vehicle.id}`).expect(200);
      const countBefore = before.body.verifiedServices;

      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00' }).expect(200);

      const after = await as(admin).get(`/service-receipts/maintenance/vehicles/${seed.vehicle.id}`).expect(200);
      expect(after.body.verifiedServices).toBe(countBefore + 1);
      // And it says out loud what the figures rest on.
      expect(after.body.basis).toMatch(/verified/i);
    });

    it('reports a due service from a verified next-service date, and only a verified one', async () => {
      // An extraction claiming a long-overdue service, never verified: it must not raise anything.
      const { expenseId: unverified } = await uploadServiceReceipt();
      ai.next = async () => ({ ...EXTRACTION, nextServiceDate: '2000-01-02', invoiceDate: '2000-01-01' });
      await drainQueue();
      const quiet = await as(admin).get('/service-receipts/maintenance/summary').expect(200);
      expect(JSON.stringify(quiet.body.dueServices)).not.toContain('2000-01-02');
      expect(await statusOf(unverified)).not.toBe('VERIFIED');

      // Verified today, with the workshop's next date ten days out: now it is a fact worth showing.
      const today = new Date().toISOString().slice(0, 10);
      const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      const { expenseId } = await uploadServiceReceipt();
      await drainQueue();
      await as(admin).post(`/service-receipts/${expenseId}/verify`, { amount: '2596.00', expenseDate: today, nextServiceDate: inTenDays }).expect(200);

      const vehicle = await as(admin).get(`/service-receipts/maintenance/vehicles/${seed.vehicle.id}`).expect(200);
      expect(vehicle.body.nextService).toMatchObject({ source: 'workshop', status: 'upcoming', dueDate: inTenDays });
      expect(vehicle.body.observations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'service_due' })]));
      const summary = await as(admin).get('/service-receipts/maintenance/summary').expect(200);
      expect(summary.body.dueServices).toEqual(
        expect.arrayContaining([expect.objectContaining({ vehicle: expect.objectContaining({ id: seed.vehicle.id }), status: 'upcoming', dueDate: inTenDays })]),
      );
    });

    it('presents everything as observation, never as instruction', async () => {
      const response = await as(admin).get(`/service-receipts/maintenance/vehicles/${seed.vehicle.id}`).expect(200);
      for (const observation of response.body.observations) {
        expect(['service_due', 'estimated_reminder', 'frequent_service', 'repeated_issue', 'recurring_vendor']).toContain(observation.kind);
        expect(['info', 'attention']).toContain(observation.severity);
      }
      // Nothing here authorises a repair, books anything, or judges a vehicle's safety.
      expect(JSON.stringify(response.body)).not.toMatch(/approve|authoris|book (the )?service|unsafe|roadworth/i);
    });

    it('separates verified spend from receipts still awaiting review', async () => {
      const summary = await as(admin).get('/service-receipts/maintenance/summary').expect(200);
      expect(summary.body).toMatchObject({
        verifiedServices: expect.any(Number),
        awaitingReview: expect.any(Number),
        verifiedSpend: expect.any(String),
        dueServices: expect.any(Array),
        repeatedIssues: expect.any(Array),
        recent: expect.any(Array),
      });
      expect(summary.body.basis).toMatch(/excluded from every figure/i);
    });

    it('keeps maintenance intelligence away from drivers', async () => {
      await as(driver).get('/service-receipts/maintenance/summary').expect(403);
      await as(driver).get(`/service-receipts/maintenance/vehicles/${seed.vehicle.id}`).expect(403);
    });
  });

  // ─────────────────────── Inbox ───────────────────────

  describe('the company mailbox', () => {
    const email = (over: Partial<InboundEmail> = {}): InboundEmail => ({
      providerMessageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: 'billing@sharmaauto.example',
      fromName: 'Sharma Auto Works',
      toAddresses: ['office@gangamata.example'],
      ccAddresses: [],
      subject: 'Invoice INV-2291',
      receivedAt: new Date(),
      bodyText: 'Please find attached invoice INV-2291 for brake work.',
      hasHtml: false,
      labels: [],
      attachments: [],
      ...over,
    });

    beforeEach(() => {
      mailbox.messages = [];
    });

    it('files what arrived', async () => {
      mailbox.messages = [email({ providerMessageId: 'sync-1' }), email({ providerMessageId: 'sync-2', subject: 'Statement' })];

      const outcome = await as(admin).post('/inbox/sync', {}).expect(200);
      expect(outcome.body).toMatchObject({ ok: true, created: 2, duplicates: 0 });

      const list = await as(admin).get('/inbox/messages').expect(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('files nothing twice, however often the sync runs', async () => {
      mailbox.messages = [email({ providerMessageId: 'dup-1' })];
      await as(admin).post('/inbox/sync', {}).expect(200);

      // The cursor is reset so the same message is offered again — exactly what an overlapping
      // window after a failure looks like.
      await prisma.emailSyncCursor.updateMany({ where: { companyId: seed.company.id }, data: { cursor: null } });
      const second = await as(admin).post('/inbox/sync', {}).expect(200);

      expect(second.body.created).toBe(0);
      expect(second.body.duplicates).toBe(1);
      expect(await prisma.inboxMessage.count({ where: { companyId: seed.company.id, providerMessageId: 'dup-1' } })).toBe(1);
    });

    it('stores a supported attachment and links it to the message', async () => {
      mailbox.messages = [
        email({
          providerMessageId: 'att-1',
          attachments: [{ providerAttachmentId: 'p1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 5_000, content: new Uint8Array([37, 80, 68, 70]) }],
        }),
      ];
      await as(admin).post('/inbox/sync', {}).expect(200);

      const message = await prisma.inboxMessage.findFirstOrThrow({
        where: { companyId: seed.company.id, providerMessageId: 'att-1' },
        include: { attachments: true },
      });
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]!.fileId).not.toBeNull();

      // Downloadable through the ordinary file route, with the ordinary permission checks.
      const download = await as(admin).get(`/inbox/messages/${message.id}/attachments/${message.attachments[0]!.id}`).expect(200);
      expect(download.headers['content-disposition']).toContain('attachment');
    });

    it('refuses a dangerous attachment but still records that it arrived', async () => {
      mailbox.messages = [
        email({
          providerMessageId: 'att-bad',
          attachments: [{ providerAttachmentId: 'p1', filename: 'invoice.pdf.exe', mimeType: 'application/pdf', sizeBytes: 2_000, content: new Uint8Array([77, 90]) }],
        }),
      ];
      await as(admin).post('/inbox/sync', {}).expect(200);

      const message = await prisma.inboxMessage.findFirstOrThrow({
        where: { companyId: seed.company.id, providerMessageId: 'att-bad' },
        include: { attachments: true },
      });
      // Not stored — but visible, with a reason, so nobody wonders where it went.
      expect(message.attachments[0]!.fileId).toBeNull();
      expect(message.attachments[0]!.skipReason).toBe('suspicious_extension');

      await as(admin).get(`/inbox/messages/${message.id}/attachments/${message.attachments[0]!.id}`).expect(400);
    });

    it('classifies a message, and records the reading as a version', async () => {
      mailbox.messages = [email({ providerMessageId: 'cls-1' })];
      ai.next = async () => ({
        classification: 'MAINTENANCE',
        confidence: 0.9,
        summary: 'An invoice for brake work.',
        references: [{ type: 'invoice_number', value: 'INV-2291' }],
        warnings: [],
      });
      await as(admin).post('/inbox/sync', {}).expect(200);

      const message = await prisma.inboxMessage.findFirstOrThrow({
        where: { companyId: seed.company.id, providerMessageId: 'cls-1' },
        include: { aiResults: true },
      });
      expect(message.classification).toBe('MAINTENANCE');
      expect(message.aiStatus).toBe('COMPLETED');
      expect(message.aiResults[0]).toMatchObject({ version: 1, classification: 'MAINTENANCE' });
      expect(Number(message.aiResults[0]!.confidence)).toBeCloseTo(0.9, 2);
      // The classification came from AI, so nobody is recorded as having decided it.
      expect(message.classifiedById).toBeNull();
      // And applying it is on the record.
      expect(await prisma.auditLog.count({ where: { action: 'inbox.ai_classified', entityId: message.id } })).toBe(1);
    });

    it('records a low-confidence reading without filing the mail under it', async () => {
      mailbox.messages = [email({ providerMessageId: 'cls-low' })];
      ai.next = async () => ({
        classification: 'FINANCE',
        confidence: 0.2,
        summary: 'Possibly a bank notice.',
        references: [],
        suggestedActions: [{ type: 'REVIEW_FINANCE', reason: 'Maybe a loan statement.' }],
        warnings: [],
      });
      await as(admin).post('/inbox/sync', {}).expect(200);

      const message = await prisma.inboxMessage.findFirstOrThrow({
        where: { companyId: seed.company.id, providerMessageId: 'cls-low' },
        include: { aiResults: true, suggestions: true },
      });
      expect(message.classification).toBe('UNCLASSIFIED');
      expect(message.aiResults[0]!.classification).toBe('FINANCE');
      expect(message.aiResults[0]!.warnings.join(' ')).toMatch(/low confidence/i);
      // A guess suggests nothing.
      expect(message.suggestions).toHaveLength(0);
    });

    it('never overrides a classification a person set', async () => {
      mailbox.messages = [email({ providerMessageId: 'cls-human' })];
      await as(admin).post('/inbox/sync', {}).expect(200);
      const message = await prisma.inboxMessage.findFirstOrThrow({ where: { companyId: seed.company.id, providerMessageId: 'cls-human' } });

      await as(admin).patch(`/inbox/messages/${message.id}/classification`, { classification: 'VEHICLE_DOCUMENT' }).expect(200);

      ai.next = async () => ({ classification: 'SPAM', confidence: 0.99, summary: 'Marketing.', references: [], warnings: [] });
      await as(admin).post(`/inbox/messages/${message.id}/retry-ai`).expect(200);

      const after = await prisma.inboxMessage.findUniqueOrThrow({
        where: { id: message.id },
        include: { aiResults: { orderBy: { version: 'desc' } } },
      });
      // The office's decision stands; the model's reading is recorded beside it.
      expect(after.classification).toBe('VEHICLE_DOCUMENT');
      expect(after.classifiedById).toBe(seed.admin.id);
      expect(after.aiResults[0]!.classification).toBe('SPAM');
    });

    it('records a classification failure without losing the message', async () => {
      mailbox.messages = [email({ providerMessageId: 'cls-fail' })];
      ai.next = async () => {
        throw new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      };
      await as(admin).post('/inbox/sync', {}).expect(200);

      const message = await prisma.inboxMessage.findFirstOrThrow({ where: { companyId: seed.company.id, providerMessageId: 'cls-fail' } });
      // A transient failure is scheduled again rather than abandoned.
      expect(message.aiStatus).toBe('RETRYING');
      expect(message.aiNextAttemptAt).not.toBeNull();
      expect(message.aiFailureCode).toBe('PROVIDER_UNAVAILABLE');
      // The mail itself is filed and readable regardless.
      expect(message.subject).toBe('Invoice INV-2291');
      expect(message.classification).toBe('UNCLASSIFIED');

      // When the retry comes due and the provider is back, it is classified.
      await prisma.inboxMessage.update({ where: { id: message.id }, data: { aiNextAttemptAt: new Date(0) } });
      ai.next = null;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { InboxService } = require('../src/modules/inbox/inbox.service');
      await app.get(InboxService).classifyPending(seed.company.id, 50);
      const after = await prisma.inboxMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.aiStatus).toBe('COMPLETED');
      expect(after.aiAttempts).toBe(2);
    });

    it('stops retrying a classification after the configured attempts', async () => {
      mailbox.messages = [email({ providerMessageId: 'cls-fail-max' })];
      ai.next = async () => {
        throw new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      };
      await as(admin).post('/inbox/sync', {}).expect(200);
      const message = await prisma.inboxMessage.findFirstOrThrow({ where: { companyId: seed.company.id, providerMessageId: 'cls-fail-max' } });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { InboxService } = require('../src/modules/inbox/inbox.service');
      for (let i = 0; i < 3; i += 1) {
        await prisma.inboxMessage.update({ where: { id: message.id }, data: { aiNextAttemptAt: new Date(0) } });
        await app.get(InboxService).classifyPending(seed.company.id, 50);
      }
      const after = await prisma.inboxMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.aiStatus).toBe('FAILED');
      expect(after.aiAttempts).toBe(3);
    });

    it('reports a mailbox failure as a failure, never as a successful sync', async () => {
      mailbox.failWith = new EmailProviderError('The mail server could not be reached.', 'UNAVAILABLE', true);

      const outcome = await as(admin).post('/inbox/sync', {}).expect(200);
      expect(outcome.body.ok).toBe(false);
      expect(outcome.body.retryable).toBe(true);
      expect(outcome.body.created).toBe(0);
      expect(outcome.body.reason).toMatch(/could not be reached/i);

      const status = await as(admin).get('/inbox/status').expect(200);
      expect(status.body.lastError).toMatch(/could not be reached/i);
      expect(status.body.consecutiveFailures).toBeGreaterThan(0);
      // The scheduler backs off rather than hammering a mailbox that is down.
      expect(status.body.nextAttemptAt).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { companyId: seed.company.id, action: 'inbox.sync_failed' } })).toBeGreaterThan(0);

      // And a clean run afterwards clears it.
      mailbox.failWith = null;
      await as(admin).post('/inbox/sync', {}).expect(200);
      const recovered = await as(admin).get('/inbox/status').expect(200);
      expect(recovered.body).toMatchObject({ lastError: null, consecutiveFailures: 0, nextAttemptAt: null });
    });

    it('pages through a backlog in one run, and audits the sync', async () => {
      mailbox.messages = [email({ providerMessageId: 'page-1' }), email({ providerMessageId: 'page-2' }), email({ providerMessageId: 'page-3' })];
      const outcome = await as(admin).post('/inbox/sync', { limit: 1 }).expect(200);
      expect(outcome.body).toMatchObject({ ok: true, created: 3, pages: 3, hasMore: false });

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { companyId: seed.company.id, action: 'inbox.synced' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(entry.actorUserId).toBe(seed.admin.id);
      expect(entry.changes).toMatchObject({ trigger: 'manual', created: 3, pages: 3 });
    });

    it('retries an attachment whose download failed, on a later sync', async () => {
      mailbox.attachmentFailures = 1;
      mailbox.messages = [
        email({
          providerMessageId: 'att-retry',
          // No bytes with the message: they must be fetched, as the Gmail and Graph APIs require.
          attachments: [{ providerAttachmentId: 'p1', filename: 'job-card.pdf', mimeType: 'application/pdf', sizeBytes: 4 }],
        }),
      ];
      await as(admin).post('/inbox/sync', {}).expect(200);
      const filed = await prisma.inboxAttachment.findFirstOrThrow({ where: { companyId: seed.company.id, message: { providerMessageId: 'att-retry' } } });
      expect(filed).toMatchObject({ fileId: null, skipReason: 'download_failed', downloadAttempts: 1 });

      const second = await as(admin).post('/inbox/sync', {}).expect(200);
      expect(second.body.attachmentsRecovered).toBeGreaterThanOrEqual(1);
      const recovered = await prisma.inboxAttachment.findUniqueOrThrow({ where: { id: filed.id } });
      expect(recovered.fileId).not.toBeNull();
      expect(recovered.skipReason).toBeNull();
    });

    it('never returns email HTML as markup', async () => {
      mailbox.messages = [
        email({
          providerMessageId: 'html-1',
          bodyText: 'Statement ready. Amount: 12000',
          hasHtml: true,
        }),
      ];
      await as(admin).post('/inbox/sync', {}).expect(200);
      const message = await prisma.inboxMessage.findFirstOrThrow({ where: { companyId: seed.company.id, providerMessageId: 'html-1' } });

      const detail = await as(admin).get(`/inbox/messages/${message.id}`).expect(200);
      expect(detail.body.hasHtml).toBe(true);
      expect(detail.body.bodyText).not.toContain('<');
      expect(detail.body).not.toHaveProperty('bodyHtml');
    });

    it('marks a message read without touching anything else', async () => {
      mailbox.messages = [email({ providerMessageId: 'read-1' })];
      await as(admin).post('/inbox/sync', {}).expect(200);
      const message = await prisma.inboxMessage.findFirstOrThrow({ where: { companyId: seed.company.id, providerMessageId: 'read-1' } });

      await as(admin).patch(`/inbox/messages/${message.id}/status`, { status: 'READ' }).expect(200);
      expect((await prisma.inboxMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('READ');
    });

    it('keeps company mail away from drivers entirely', async () => {
      await as(driver).get('/inbox/messages').expect(403);
      await as(driver).get('/inbox/status').expect(403);
      await as(driver).post('/inbox/sync', {}).expect(403);
      await as(driver).get('/inbox/suggestions').expect(403);
      await as(driver).post('/inbox/connection/authorize').expect(403);
      await as(driver).post('/inbox/connection/disconnect').expect(403);
    });

    it('says plainly that an IMAP mailbox is configured on the server, not connected by OAuth', async () => {
      const status = await as(admin).get('/inbox/status').expect(200);
      expect(status.body.connection).toMatchObject({ mode: 'imap', canConnect: false });
      // There is nothing to authorise for a server-configured mailbox, and the API says so.
      await as(admin).post('/inbox/connection/authorize').expect(400);
    });

    it('does not let accounting trigger a sync, which is a fleet operation', async () => {
      await as(accounting).get('/inbox/messages').expect(200);
      await as(accounting).post('/inbox/sync', {}).expect(403);
    });

    describe('suggested actions are reviewable, never automatic', () => {
      const invoiceMail = (id: string) =>
        email({
          providerMessageId: id,
          attachments: [{ providerAttachmentId: 'p1', filename: 'invoice-2291.pdf', mimeType: 'application/pdf', sizeBytes: 4, content: new Uint8Array([37, 80, 68, 70]) }],
        });
      const reading = (actions: unknown[]) => async () => ({
        classification: 'MAINTENANCE',
        confidence: 0.9,
        summary: 'Sharma Auto Works invoice for brake work.',
        references: [{ type: 'invoice_number', value: 'INV-2291' }],
        suggestedActions: actions,
        warnings: [],
      });
      const fileWith = async (id: string, actions: unknown[]) => {
        mailbox.messages = [invoiceMail(id)];
        ai.next = reading(actions);
        await as(admin).post('/inbox/sync', {}).expect(200);
        return prisma.inboxMessage.findFirstOrThrow({
          where: { companyId: seed.company.id, providerMessageId: id },
          include: { suggestions: true, attachments: true },
        });
      };

      it('stores a suggestion as pending and creates nothing', async () => {
        const expensesBefore = await prisma.vehicleExpense.count({ where: { companyId: seed.company.id } });
        const message = await fileWith('sug-pending', [
          { type: 'CREATE_SERVICE_RECORD', reason: 'A workshop invoice.', attachment: 'invoice-2291.pdf', vehicleRegistration: seed.vehicle.registrationNumber, amount: 2596, date: '2026-03-04', reference: 'INV-2291' },
          { type: 'REVIEW_PAYMENT', reason: 'Payment is requested.', amount: '2,596' },
        ]);

        expect(message.suggestions.map((s) => [s.type, s.status]).sort()).toEqual([
          ['CREATE_SERVICE_RECORD', 'PENDING'],
          ['REVIEW_PAYMENT', 'PENDING'],
        ]);
        // The suggestion knows which attachment it is about.
        const service = message.suggestions.find((s) => s.type === 'CREATE_SERVICE_RECORD')!;
        expect(service.attachmentId).toBe(message.attachments[0]!.id);
        // Nothing financial or operational was created by the reading.
        expect(await prisma.vehicleExpense.count({ where: { companyId: seed.company.id } })).toBe(expensesBefore);

        const queue = await as(accounting).get('/inbox/suggestions').expect(200);
        expect(queue.body.data.some((s: { id: string }) => s.id === service.id)).toBe(true);
        const summary = await as(admin).get('/inbox/summary').expect(200);
        expect(summary.body.pendingSuggestions).toBeGreaterThanOrEqual(2);
      });

      it('turns an accepted invoice into a service record that still goes through Service AI review', async () => {
        const message = await fileWith('sug-accept', [{ type: 'CREATE_SERVICE_RECORD', reason: 'A workshop invoice.', attachment: 'invoice-2291.pdf' }]);
        const suggestion = message.suggestions[0]!;

        const accepted = await as(admin)
          .post(`/inbox/suggestions/${suggestion.id}/accept`, {
            note: 'Checked against the PDF.',
            serviceRecord: { vehicleId: seed.vehicle.id, amount: 2596, expenseDate: new Date().toISOString().slice(0, 10), vendorName: 'Sharma Auto Works' },
          })
          .expect(200);
        expect(accepted.body).toMatchObject({ status: 'ACCEPTED', result: { entityType: 'VehicleExpense' } });

        const expense = await prisma.vehicleExpense.findUniqueOrThrow({ where: { id: accepted.body.result.entityId } });
        // The emailed invoice is the receipt, and reading it is queued — not verified.
        expect(expense).toMatchObject({ category: 'MAINTENANCE', receiptFileId: message.attachments[0]!.fileId, aiStatus: 'QUEUED' });
        expect(expense.aiVerifiedAt).toBeNull();

        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'inbox.suggestion_accepted', entityId: suggestion.id } });
        expect(audit.actorUserId).toBe(seed.admin.id);

        // A decision is final: accepting again is refused, and no second record appears.
        await as(admin)
          .post(`/inbox/suggestions/${suggestion.id}/accept`, {
            serviceRecord: { vehicleId: seed.vehicle.id, amount: 2596, expenseDate: new Date().toISOString().slice(0, 10) },
          })
          .expect(409);
        expect(await prisma.vehicleExpense.count({ where: { clientSubmissionId: `inbox-suggestion:${suggestion.id}` } })).toBe(1);
      });

      it('needs the checked figures before an invoice can become a record', async () => {
        const message = await fileWith('sug-missing', [{ type: 'CREATE_SERVICE_RECORD', reason: 'A workshop invoice.', attachment: 'invoice-2291.pdf' }]);
        await as(admin).post(`/inbox/suggestions/${message.suggestions[0]!.id}/accept`, {}).expect(400);
      });

      it('records a rejection with its author', async () => {
        const message = await fileWith('sug-reject', [{ type: 'REVIEW_VEHICLE_DOCUMENT', reason: 'An insurance renewal.' }]);
        const suggestion = message.suggestions[0]!;
        const rejected = await as(admin).post(`/inbox/suggestions/${suggestion.id}/reject`, { note: 'Already renewed.' }).expect(200);
        expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionNote: 'Already renewed.' });
        expect(await prisma.auditLog.count({ where: { action: 'inbox.suggestion_rejected', entityId: suggestion.id } })).toBe(1);
      });

      it('lets each role decide only what it may act on elsewhere', async () => {
        const message = await fileWith('sug-rbac', [
          { type: 'REVIEW_VEHICLE_DOCUMENT', reason: 'Insurance.' },
          { type: 'REVIEW_PAYMENT', reason: 'Payment.' },
        ]);
        const vehicleDoc = message.suggestions.find((s) => s.type === 'REVIEW_VEHICLE_DOCUMENT')!;
        const payment = message.suggestions.find((s) => s.type === 'REVIEW_PAYMENT')!;

        // Accounting owns payments, not vehicle documents.
        await as(accounting).post(`/inbox/suggestions/${vehicleDoc.id}/accept`, {}).expect(403);
        await as(accounting).post(`/inbox/suggestions/${payment.id}/accept`, { note: 'Will pay this week.' }).expect(200);
        // Accepting a payment suggestion records the decision; it never creates a payment.
        const after = await prisma.inboxSuggestion.findUniqueOrThrow({ where: { id: payment.id } });
        expect(after.resultEntityId).toBeNull();
        await as(driver).post(`/inbox/suggestions/${vehicleDoc.id}/reject`, {}).expect(403);
      });

      it('replaces undecided suggestions when the mail is read again, and keeps decided ones', async () => {
        const message = await fileWith('sug-reread', [
          { type: 'REVIEW_PAYMENT', reason: 'Payment.' },
          { type: 'REVIEW_FINANCE', reason: 'Loan.' },
        ]);
        const payment = message.suggestions.find((s) => s.type === 'REVIEW_PAYMENT')!;
        await as(admin).post(`/inbox/suggestions/${payment.id}/reject`, {}).expect(200);

        ai.next = reading([{ type: 'REVIEW_FINANCE', reason: 'A loan statement.' }]);
        await as(admin).post(`/inbox/messages/${message.id}/retry-ai`).expect(200);

        const all = await prisma.inboxSuggestion.findMany({ where: { messageId: message.id }, orderBy: { createdAt: 'asc' } });
        expect(all.map((s) => [s.type, s.status])).toEqual([
          ['REVIEW_PAYMENT', 'REJECTED'],
          ['REVIEW_FINANCE', 'SUPERSEDED'],
          ['REVIEW_FINANCE', 'PENDING'],
        ]);
      });
    });

    it('exposes no mailbox credentials anywhere in its responses', async () => {
      const status = await as(admin).get('/inbox/status').expect(200);
      const serialised = JSON.stringify(status.body);
      expect(serialised).not.toMatch(/password|IMAP_PASSWORD|apiKey/i);
    });
  });
});
