import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MockRazorpayX } from './mock-razorpayx';

/**
 * Phase 5: finance & payments, end to end — the real app, database and RazorpayX adapter, with
 * RazorpayX itself replaced by a local mock that behaves like the documented API.
 *
 * The payout environment must exist before the app module is loaded (configuration is read at
 * import), so the fixture is imported only after the mock is listening.
 */
const WEBHOOK_SECRET = 'whsec_e2e_only';

describe('Phase 5: finance & payments (e2e)', () => {
  const mock = new MockRazorpayX();
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: typeof import('./app-fixture');
  let seed: Awaited<ReturnType<typeof import('./app-fixture')['seedCompany']>>;
  let admin: string;
  let driver: string;

  const api = () => request(app.getHttpServer());
  const V = '/api/v1';
  const login = async (identifier: string) =>
    (await api().post(`${V}/auth/login`).send({ identifier, password: fixture.TEST_PASSWORD }).expect(200)).body.accessToken as string;
  const as = (token: string) => ({
    get: (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => api().post(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object = {}) => api().put(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => api().patch(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  let eventCounter = 0;
  const webhook = (event: string, payoutId: string, failureReason?: string, eventId = `evt_${Date.now()}_${++eventCounter}`) => {
    const { body, signature } = mock.webhook(WEBHOOK_SECRET, event, mock.payouts.get(payoutId)!, failureReason);
    return api()
      .post(`${V}/webhooks/razorpayx`)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .set('X-Razorpay-Event-Id', eventId)
      .send(body);
  };

  const period = (() => {
    const d = new Date();
    return (offset: number) => {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1));
      return m.toISOString().slice(0, 7);
    };
  })();
  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const baseUrl = await mock.start();
    Object.assign(process.env, {
      PAYOUT_PROVIDER: 'razorpayx',
      RAZORPAYX_BASE_URL: baseUrl,
      RAZORPAYX_KEY_ID: 'rzp_test_e2e',
      RAZORPAYX_KEY_SECRET: 'e2e-secret',
      RAZORPAYX_ACCOUNT_NUMBER: '7878780080316316',
      RAZORPAYX_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    // Loaded only now, after the payout environment is set (see the note at the top).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fixture = require('./app-fixture') as typeof import('./app-fixture');
    app = await fixture.createTestApp();
    prisma = fixture.rawPrisma();
    seed = await fixture.seedCompany(prisma);
    admin = await login(seed.admin.identifier);
    driver = await login(seed.driver.identifier);
    await as(admin).put(`/payments/payout-accounts/${seed.driver.employeeId}`, {
      method: 'BANK_TRANSFER', accountHolderName: 'Test Driver', ifsc: 'SBIN0001234', accountNumber: '123456789012',
    }).expect(200);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    await mock.stop();
  });

  /** A pending salary for the driver in a month not used elsewhere. */
  const salary = async (monthsAgo: number, base = 20000) =>
    (await as(admin).post('/finance/salaries', { employeeId: seed.driver.employeeId, payPeriod: period(monthsAgo), baseSalary: base }).expect(201)).body;
  const approvedPayout = async (salaryId: string) => {
    const payment = (await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'SALARY', method: 'BANK_TRANSFER', provider: 'RAZORPAYX', salaryRecordId: salaryId }).expect(201)).body;
    await as(admin).post(`/payments/${payment.id}/approve`).expect(200);
    return payment.id as string;
  };

  describe('salaries, advances and the ledger', () => {
    it('recovers a paid advance from a salary, with exact Decimal arithmetic', async () => {
      const advance = (await as(admin).post('/finance/advances', { employeeId: seed.driver.employeeId, type: 'TRIP_ADVANCE', amount: 2000.5, advanceDate: today(), reason: 'Hubli trip' }).expect(201)).body;
      expect(advance).toMatchObject({ amount: '2000.50', status: 'PENDING', recovered: false });

      // Pay the advance by hand.
      const pay = (await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'ADVANCE', method: 'CASH', provider: 'MANUAL', advanceId: advance.id }).expect(201)).body;
      expect(pay.amount).toBe('2000.50');
      await as(admin).post(`/payments/${pay.id}/approve`).expect(200);
      await as(admin).post(`/payments/${pay.id}/record-manual`, { reference: 'Cash voucher 17', paidOn: '2999-01-01' }).expect(400);
      await as(admin).post(`/payments/${pay.id}/record-manual`, { reference: 'Cash voucher 17' }).expect(200);

      const trips = (await as(admin).get(`/finance/advances?type=TRIP_ADVANCE&employeeId=${seed.driver.employeeId}`).expect(200)).body.data;
      expect(trips.every((a: { type: string }) => a.type === 'TRIP_ADVANCE')).toBe(true);
      expect(trips.map((a: { id: string }) => a.id)).toContain(advance.id);

      // Only paid, unrecovered advances are offered for recovery.
      const recoverable = (await as(admin).get(`/finance/advances?recoverable=true&employeeId=${seed.driver.employeeId}`).expect(200)).body.data;
      expect(recoverable.map((a: { id: string }) => a.id)).toContain(advance.id);

      const created = (await as(admin).post('/finance/salaries', {
        employeeId: seed.driver.employeeId, payPeriod: period(1), baseSalary: 25000, allowances: 1500.25, deductions: 500, recoverAdvanceIds: [advance.id],
      }).expect(201)).body;
      // 25000 + 1500.25 − 2000.50 − 500 = 23999.75, exactly.
      expect(created).toMatchObject({ baseSalary: '25000.00', allowances: '1500.25', advanceRecovery: '2000.50', deductions: '500.00', netPayable: '23999.75', status: 'PENDING' });

      // The same advance cannot be recovered twice.
      await as(admin).post('/finance/salaries', { employeeId: seed.driver.employeeId, payPeriod: period(2), baseSalary: 25000, recoverAdvanceIds: [advance.id] }).expect(400);
      // One salary per employee per month.
      await as(admin).post('/finance/salaries', { employeeId: seed.driver.employeeId, payPeriod: period(1), baseSalary: 1 }).expect(409);

      // Advance and salary are separate ledger lines — never merged.
      const ledger = (await as(admin).get(`/finance/ledger?employeeId=${seed.driver.employeeId}`).expect(200)).body;
      const types = ledger.data.map((l: { type: string }) => l.type);
      expect(types).toEqual(expect.arrayContaining(['SALARY', 'ADVANCE']));
      expect(ledger.data.find((l: { type: string }) => l.type === 'SALARY').amount).toBe('23999.75');

      // Cancelling the salary releases the advance and reverses the ledger line.
      await as(admin).post(`/finance/salaries/${created.id}/cancel`, { reason: 'Entered in the wrong month' }).expect(200);
      const again = (await as(admin).get(`/finance/advances?recoverable=true&employeeId=${seed.driver.employeeId}`).expect(200)).body.data;
      expect(again.map((a: { id: string }) => a.id)).toContain(advance.id);
      const salaryLines = await prisma.financeLedgerEntry.findMany({ where: { sourceType: 'SALARY', sourceId: created.id } });
      expect(salaryLines.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(0);
    });

    it('rejects amounts with more than two decimals and negative net pay', async () => {
      await as(admin).post('/finance/advances', { employeeId: seed.driver.employeeId, type: 'OTHER_ADVANCE', amount: 10.005, advanceDate: today() }).expect(400);
      await as(admin).post('/finance/salaries', { employeeId: seed.driver.employeeId, payPeriod: period(20), baseSalary: 100, deductions: 200 }).expect(400);
    });

    it('filters the ledger by financial year (1 April – 31 March)', async () => {
      const march = (await as(admin).post('/finance/advances', { employeeId: seed.driver.employeeId, type: 'OTHER_ADVANCE', amount: 111.11, advanceDate: '2026-03-31' }).expect(201)).body;
      const april = (await as(admin).post('/finance/advances', { employeeId: seed.driver.employeeId, type: 'OTHER_ADVANCE', amount: 222.22, advanceDate: '2026-04-01' }).expect(201)).body;
      const ids = async (fy: string) =>
        ((await as(admin).get(`/finance/ledger?fy=${fy}&type=ADVANCE&limit=100`).expect(200)).body.data as { sourceId: string }[]).map((l) => l.sourceId);

      expect(await ids('2025-26')).toContain(march.id);
      expect(await ids('2025-26')).not.toContain(april.id);
      expect(await ids('2026-27')).toContain(april.id);
      expect(await ids('2026-27')).not.toContain(march.id);
    });

    it('reverses a standalone payment line when the payment is cancelled', async () => {
      const allowance = (await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'CASH', provider: 'MANUAL', amount: 750, description: 'Festival allowance' }).expect(201)).body;
      await as(admin).post(`/payments/${allowance.id}/cancel`, { reason: 'Duplicate' }).expect(200);
      const lines = await prisma.financeLedgerEntry.findMany({ where: { sourceType: 'PAYMENT', sourceId: allowance.id } });
      expect(lines).toHaveLength(2);
      expect(lines.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(0);
    });
  });

  describe('payout account', () => {
    it('stores only masked details — the full account number is never kept', async () => {
      const account = (await as(admin).get(`/payments/payout-accounts/${seed.driver.employeeId}`).expect(200)).body.account;
      expect(account).toMatchObject({ method: 'BANK_TRANSFER', ifsc: 'SBIN0001234', accountNumberLast4: '9012' });

      const row = await prisma.employeePayoutAccount.findUniqueOrThrow({ where: { employeeId: seed.driver.employeeId } });
      expect(JSON.stringify(row)).not.toContain('123456789012');
      const audit = await prisma.auditLog.findMany({ where: { action: 'payout_account.saved', entityId: seed.driver.employeeId } });
      expect(JSON.stringify(audit)).not.toContain('123456789012');
    });

    it('validates IFSC and UPI', async () => {
      await as(admin).put(`/payments/payout-accounts/${seed.driver.employeeId}`, { method: 'BANK_TRANSFER', accountHolderName: 'X', ifsc: 'BAD', accountNumber: '123456789012' }).expect(400);
      await as(admin).put(`/payments/payout-accounts/${seed.driver.employeeId}`, { method: 'UPI', accountHolderName: 'X', upiId: 'not-a-upi' }).expect(400);
    });
  });

  describe('RazorpayX payouts', () => {
    it('create → approve → send → PROCESSING → webhook → PAID, seen by the driver as their own', async () => {
      const s = await salary(3, 18000);
      const payment = (await as(admin).post('/payments', {
        employeeId: seed.driver.employeeId, type: 'SALARY', method: 'BANK_TRANSFER', provider: 'RAZORPAYX', salaryRecordId: s.id, amount: 1,
      }).expect(201)).body;
      // The amount comes from the salary, never from the request.
      expect(payment).toMatchObject({ amount: '18000.00', status: 'PENDING_APPROVAL', recipientSummary: null });

      // Cannot be sent before approval.
      await as(admin).post(`/payments/${payment.id}/send`).expect(400);
      await as(admin).post(`/payments/${payment.id}/approve`).expect(200);

      const sent = (await as(admin).post(`/payments/${payment.id}/send`).expect(200)).body;
      expect(sent.outcome).toBe('accepted');
      expect(sent.payment).toMatchObject({ status: 'PROCESSING', attempt: 1, recipientSummary: 'A/c XXXX9012 · SBIN0001234' });
      const payoutId = sent.payment.providerReference as string;
      expect(mock.payouts.get(payoutId)).toMatchObject({ amount: 1_800_000, reference_id: payment.id });
      expect(mock.requests.find((r) => r.path === '/v1/payouts' && r.idempotencyKey)?.idempotencyKey).toMatch(/^gm-.+-1$/);

      mock.setStatus(payoutId, 'processed', 'UTR123456789');
      await webhook('payout.processed', payoutId).expect(200);

      const paid = (await as(admin).get(`/payments/${payment.id}`).expect(200)).body;
      expect(paid).toMatchObject({ status: 'PAID', paymentReference: 'UTR123456789' });
      expect((await as(admin).get(`/finance/salaries/${s.id}`).expect(200)).body.status).toBe('PAID');

      const events = await prisma.financeEvent.findMany({ where: { paymentRecordId: payment.id }, orderBy: { occurredAt: 'asc' } });
      expect(events.map((e) => e.type)).toEqual(['PAYMENT_CREATED', 'PAYMENT_PROCESSING', 'PAYMENT_PAID']);

      const summary = (await as(admin).get('/payments/summary').expect(200)).body;
      expect(Number(summary.paidThisMonth.amount)).toBeGreaterThanOrEqual(18000);
      expect(summary.byStatus.PAID.count).toBeGreaterThanOrEqual(1);
      await as(driver).get('/payments/summary').expect(403);

      // The driver sees it — as their own, without provider internals.
      const mine = (await as(driver).get('/payments/mine').expect(200)).body.data;
      const seen = mine.find((p: { id: string }) => p.id === payment.id);
      expect(seen).toMatchObject({ status: 'PAID', amount: '18000.00', utr: 'UTR123456789', type: 'SALARY' });
      expect(seen).not.toHaveProperty('providerReference');
      expect(JSON.stringify(mine)).not.toContain(payoutId);
    });

    it('ignores a redelivered webhook and an out-of-order one', async () => {
      const id = await approvedPayout((await salary(4)).id);
      const { payment } = (await as(admin).post(`/payments/${id}/send`).expect(200)).body;
      const payoutId = payment.providerReference as string;

      mock.setStatus(payoutId, 'processed', 'UTR-DUP');
      const eventId = `evt_dup_${Date.now()}`;
      expect((await webhook('payout.processed', payoutId, undefined, eventId).expect(200)).body.status).toBe('applied:PAID');
      expect((await webhook('payout.processed', payoutId, undefined, eventId).expect(200)).body.status).toBe('duplicate');
      expect(await prisma.paymentProviderEvent.count({ where: { eventId } })).toBe(1);

      // A late "processing" after "processed" must not move the payment backwards.
      mock.setStatus(payoutId, 'processing');
      await webhook('payout.updated', payoutId).expect(200);
      expect((await as(admin).get(`/payments/${id}`).expect(200)).body.status).toBe('PAID');
    });

    it('rejects webhooks with a bad signature or without an event id', async () => {
      const body = JSON.stringify({ event: 'payout.processed', payload: { payout: { entity: { id: 'pout_fake', status: 'processed' } } } });
      await api().post(`${V}/webhooks/razorpayx`).set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'forged').set('X-Razorpay-Event-Id', 'evt_forged').send(body).expect(401);
      await api().post(`${V}/webhooks/razorpayx`).set('Content-Type', 'application/json').set('X-Razorpay-Event-Id', 'evt_nosig').send(body).expect(401);
      const signed = mock.webhook(WEBHOOK_SECRET, 'payout.processed', { id: 'pout_none', amount: 100, status: 'processed', fund_account_id: 'fa', reference_id: 'r', utr: null });
      await api().post(`${V}/webhooks/razorpayx`).set('Content-Type', 'application/json').set('X-Razorpay-Signature', signed.signature).send(signed.body).expect(400);
    });

    it('sends only one payout when Send is pressed twice at once', async () => {
      const id = await approvedPayout((await salary(5)).id);
      const before = mock.payoutCount;
      const results = await Promise.all([as(admin).post(`/payments/${id}/send`), as(admin).post(`/payments/${id}/send`)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect([400, 409]).toContain(results.find((r) => r.status !== 200)!.status);
      expect(mock.payoutCount).toBe(before + 1);
    });

    it('holds an unknown outcome for review, and a status check resolves it without a second payout', async () => {
      const id = await approvedPayout((await salary(6)).id);
      const before = mock.payoutCount;

      mock.nextPayout = 'server-error'; // RazorpayX creates the payout, but we never learn of it
      const sent = (await as(admin).post(`/payments/${id}/send`).expect(200)).body;
      expect(sent.outcome).toBe('unknown');
      expect(sent.payment).toMatchObject({ status: 'STATUS_REVIEW_REQUIRED', providerReference: null });
      expect(mock.payoutCount).toBe(before + 1);

      // No blind retry: Send is refused while the outcome is unknown.
      await as(admin).post(`/payments/${id}/send`).expect(400);

      // A status check repeats the request with the SAME key and finds the existing payout.
      const checked = (await as(admin).post(`/payments/${id}/check-status`).expect(200)).body;
      expect(checked.payment).toMatchObject({ status: 'PROCESSING', attempt: 1 });
      expect(mock.payoutCount).toBe(before + 1);

      const payoutId = checked.payment.providerReference as string;
      mock.setStatus(payoutId, 'processed', 'UTR-REVIEW');
      await webhook('payout.processed', payoutId).expect(200);
      expect((await as(admin).get(`/payments/${id}`).expect(200)).body.status).toBe('PAID');
    });

    it('marks a definitive rejection FAILED and retries with a new idempotency key', async () => {
      const id = await approvedPayout((await salary(7)).id);
      mock.nextPayout = 'reject';
      const rejected = (await as(admin).post(`/payments/${id}/send`).expect(200)).body;
      expect(rejected.outcome).toBe('rejected');
      expect(rejected.payment).toMatchObject({ status: 'FAILED', failureReason: 'Invalid fund account' });

      const retried = (await as(admin).post(`/payments/${id}/send`).expect(200)).body;
      expect(retried.payment).toMatchObject({ status: 'PROCESSING', attempt: 2 });
      const keys = mock.requests.filter((r) => r.path === '/v1/payouts' && r.idempotencyKey?.includes(id)).map((r) => r.idempotencyKey);
      expect(new Set(keys)).toEqual(new Set([`gm-${id}-1`, `gm-${id}-2`]));
    });

    it('records a payout that fails at the bank, and one reversed after payment', async () => {
      const failedId = await approvedPayout((await salary(8)).id);
      const failed = (await as(admin).post(`/payments/${failedId}/send`).expect(200)).body.payment;
      mock.setStatus(failed.providerReference, 'failed');
      await webhook('payout.failed', failed.providerReference, 'Beneficiary bank offline').expect(200);
      expect((await as(admin).get(`/payments/${failedId}`).expect(200)).body).toMatchObject({ status: 'FAILED', failureReason: 'Beneficiary bank offline' });
      const mineFailed = (await as(driver).get('/payments/mine').expect(200)).body.data.find((p: { id: string }) => p.id === failedId);
      expect(mineFailed.status).toBe('FAILED');

      const s = await salary(9);
      const reversedId = await approvedPayout(s.id);
      const sent = (await as(admin).post(`/payments/${reversedId}/send`).expect(200)).body.payment;
      mock.setStatus(sent.providerReference, 'processed', 'UTR-REV');
      await webhook('payout.processed', sent.providerReference).expect(200);
      mock.setStatus(sent.providerReference, 'reversed');
      await webhook('payout.reversed', sent.providerReference).expect(200);

      expect((await as(admin).get(`/payments/${reversedId}`).expect(200)).body.status).toBe('REVERSED');
      // The money came back, so the salary is owed again and a new payment can be made.
      expect((await as(admin).get(`/finance/salaries/${s.id}`).expect(200)).body.status).toBe('PENDING');
      await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'SALARY', method: 'BANK_TRANSFER', provider: 'RAZORPAYX', salaryRecordId: s.id }).expect(201);
      const types = (await prisma.financeEvent.findMany({ where: { paymentRecordId: reversedId } })).map((e) => e.type);
      expect(types).toContain('PAYMENT_REVERSED');
    });

    it('refuses cash through RazorpayX and hand-recording a RazorpayX payment', async () => {
      const s = await salary(10);
      await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'SALARY', method: 'CASH', provider: 'RAZORPAYX', salaryRecordId: s.id }).expect(400);
      const id = await approvedPayout(s.id);
      await as(admin).post(`/payments/${id}/record-manual`, {}).expect(400);
      // One active payment per salary.
      await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'SALARY', method: 'BANK_TRANSFER', provider: 'MANUAL', salaryRecordId: s.id }).expect(409);
    });
  });

  describe('access', () => {
    it("keeps a driver to their own payments and out of payroll", async () => {
      const other = (await as(admin).post('/payments', { employeeId: seed.otherDriver.employeeId, type: 'ALLOWANCE', method: 'CASH', provider: 'MANUAL', amount: 300 }).expect(201)).body;
      const mine = (await as(driver).get('/payments/mine').expect(200)).body.data;
      expect(mine.map((p: { id: string }) => p.id)).not.toContain(other.id);

      await as(driver).get('/payments').expect(403);
      await as(driver).get('/finance/salaries').expect(403);
      await as(driver).get('/finance/ledger').expect(403);
      await as(driver).post('/payments', { employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'CASH', provider: 'MANUAL', amount: 5 }).expect(403);
    });

    it('keeps managers out of pay data', async () => {
      const manager = await prisma.user.create({
        data: { companyId: seed.company.id, email: `mgr-${Date.now()}@e2e.test`, role: 'MANAGER', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: seed.admin.id } })).passwordHash },
      });
      const token = await login(manager.email!);
      await as(token).get('/finance/salaries').expect(403);
      await as(token).get('/payments').expect(403);
    });

    it('isolates companies', async () => {
      const b = await fixture.seedCompany(prisma);
      const bAdmin = await login(b.admin.identifier);
      const aPayment = (await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'CASH', provider: 'MANUAL', amount: 100 }).expect(201)).body;

      await as(bAdmin).get(`/payments/${aPayment.id}`).expect(404);
      await as(bAdmin).post(`/payments/${aPayment.id}/approve`).expect(404);
      await as(bAdmin).post('/finance/salaries', { employeeId: seed.driver.employeeId, payPeriod: period(30), baseSalary: 1 }).expect(404);
      const bLedger = (await as(bAdmin).get('/finance/ledger?limit=100').expect(200)).body.data;
      expect(bLedger.map((l: { sourceId: string }) => l.sourceId)).not.toContain(aPayment.id);
    });
  });

  describe('vehicle EMI', () => {
    it('hides EMI for owned vehicles and manages instalments for financed ones', async () => {
      const vehicleId = seed.vehicle.id;
      await as(admin).patch(`/vehicles/${vehicleId}`, { ownership: 'OWNED' }).expect(200);
      expect((await as(admin).get(`/vehicles/${vehicleId}`).expect(200)).body.financing).toBeNull();
      await as(admin).post(`/vehicles/${vehicleId}/financing/installments/generate`).expect(400);

      await as(admin).patch(`/vehicles/${vehicleId}`, { ownership: 'FINANCED' }).expect(200);
      await as(admin).put(`/vehicles/${vehicleId}/financing`, {
        lenderName: 'Shriram Finance', loanAmount: 1200000, interestRatePct: 10.5, tenureMonths: 12, financeStartDate: '2026-01-01', nextDueDate: '2026-02-05',
      }).expect(200);

      const schedule = (await as(admin).post(`/vehicles/${vehicleId}/financing/installments/generate`).expect(201)).body;
      expect(schedule).toHaveLength(12);
      expect(schedule[0]).toMatchObject({ installmentNumber: 1, dueDate: '2026-02-05', status: 'PENDING' });
      await as(admin).post(`/vehicles/${vehicleId}/financing/installments/generate`).expect(409);

      await as(admin).post(`/vehicles/${vehicleId}/financing/installments/1/pay`, { paidOn: '2026-02-05', reference: 'NACH-1' }).expect(201);
      await as(admin).post(`/vehicles/${vehicleId}/financing/installments/1/pay`, { paidOn: '2026-02-05' }).expect(409);

      const financing = (await as(admin).get(`/vehicles/${vehicleId}`).expect(200)).body.financing;
      expect(financing).toMatchObject({ paidInstallments: 1, nextDueDate: '2026-03-05' });
      const emiLines = await prisma.financeLedgerEntry.findMany({ where: { vehicleId, type: 'EMI' } });
      expect(emiLines).toHaveLength(1);
      expect(emiLines[0]!.amount.toFixed(2)).toBe(schedule[0].amount);

      // An active loan blocks "fully owned" (Phase 1 rule) — close it first, as on foreclosure.
      await as(admin).patch(`/vehicles/${vehicleId}`, { ownership: 'OWNED' }).expect(400);
      await as(admin).put(`/vehicles/${vehicleId}/financing`, { status: 'CLOSED' }).expect(200);
      // Paying off: the vehicle becomes owned, EMI tools disappear, the history stays.
      await as(admin).patch(`/vehicles/${vehicleId}`, { ownership: 'OWNED' }).expect(200);
      const owned = (await as(admin).get(`/vehicles/${vehicleId}`).expect(200)).body;
      expect(owned.financing).toBeNull();
      expect(owned.pastFinancing).toMatchObject({ lenderName: 'Shriram Finance', paidInstallments: 1 });
      expect((await as(admin).get(`/vehicles/${vehicleId}/financing/installments`).expect(200)).body).toHaveLength(12);
      await as(admin).post(`/vehicles/${vehicleId}/financing/installments/2/pay`, { paidOn: today() }).expect(400);
    });
  });
});
