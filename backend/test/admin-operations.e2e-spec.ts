import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Admin data operations, end to end against the real app and database: hand-kept ledger entries
 * (create, edit, reverse, restore — append-only ledger, full audit), payment proof and notes, the
 * payments filters, and the dashboard's period figures.
 */
describe('admin data operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let admin: string;
  let manager: string;
  let driver: string;

  const V = '/api/v1';
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => api().post(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => api().patch(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const login = async (identifier: string) => (await api().post(`${V}/auth/login`).send({ identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;
  const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const pdf = () => Buffer.from(`%PDF-1.4\n% proof ${Date.now()} ${Math.random()}\n%%EOF\n`);

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();
    admin = await login(seed.admin.identifier);
    driver = await login(seed.driver.identifier);
    const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { id: seed.admin.id } })).passwordHash;
    const n = Date.now();
    const employee = await prisma.employee.create({ data: { companyId: seed.company.id, employeeCode: `MGR-${n}`, fullName: 'Ops Manager', role: 'MANAGER' } });
    await prisma.user.create({ data: { companyId: seed.company.id, employeeId: employee.id, email: `manager-${n}@e2e.test`, role: 'MANAGER', passwordHash } });
    manager = await login(`manager-${n}@e2e.test`);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('hand-kept ledger entries', () => {
    let entryId: string;

    it('creates an entry that appears in the ledger, with the direction taken from the type', async () => {
      const created = await as(admin)
        .post('/finance/ledger/entries', {
          transactionDate: today(),
          type: 'OTHER_EXPENSE',
          amount: 1250.5,
          description: 'Toll — NH48 Bengaluru–Tumakuru',
          vehicleId: seed.vehicle.id,
          paymentMethod: 'UPI',
          reference: 'UPI-REF-778899',
          remarks: 'FASTag recharge failed, paid at plaza',
        })
        .expect(201);
      entryId = created.body.id;
      expect(created.body).toMatchObject({ type: 'OTHER_EXPENSE', direction: 'EXPENSE', amount: '1250.50', status: 'ACTIVE', paymentMethod: 'UPI' });

      const ledger = await as(admin).get(`/finance/ledger?from=${today()}&to=${today()}&q=UPI-REF-778899`).expect(200);
      expect(ledger.body.data).toHaveLength(1);
      expect(ledger.body.data[0]).toMatchObject({ sourceType: 'MANUAL', amount: '1250.50', manual: { id: entryId, editable: true, reference: 'UPI-REF-778899' } });
      expect(ledger.body.data[0].vehicle.id).toBe(seed.vehicle.id);
    });

    it('refuses types other modules own, future dates and bad amounts', async () => {
      const base = { transactionDate: today(), type: 'OTHER_EXPENSE', amount: 10, description: 'x' };
      await as(admin).post('/finance/ledger/entries', { ...base, type: 'SALARY' }).expect(400);
      await as(admin).post('/finance/ledger/entries', { ...base, transactionDate: '2999-01-01' }).expect(400);
      await as(admin).post('/finance/ledger/entries', { ...base, amount: 0 }).expect(400);
      await as(admin).post('/finance/ledger/entries', { ...base, amount: 10.555 }).expect(400);
      await as(admin).post('/finance/ledger/entries', { ...base, description: '' }).expect(400);
    });

    it('edits by reversal and re-post — nothing is erased — and audits before and after', async () => {
      await as(admin).patch(`/finance/ledger/entries/${entryId}`, { amount: 1300, remarks: 'Corrected to the plaza receipt', reason: 'Receipt shows ₹1,300' }).expect(200);

      const detail = await as(admin).get(`/finance/ledger/entries/${entryId}`).expect(200);
      expect(detail.body.amount).toBe('1300.00');
      // Original line, its reversal, and the new line — all kept.
      expect(detail.body.lines.map((l: { amount: string }) => l.amount)).toEqual(['1250.50', '-1250.50', '1300.00']);
      const update = detail.body.history.find((h: { action: string }) => h.action === 'ledger.manual_updated');
      expect(update.changes).toEqual({
        before: { amount: '1250.50', remarks: 'FASTag recharge failed, paid at plaza' },
        after: { amount: '1300.00', remarks: 'Corrected to the plaza receipt' },
      });
      expect(update.metadata).toEqual({ reason: 'Receipt shows ₹1,300' });
      expect(update.actor).toBe('Office Admin');

      // The ledger total counts the entry once, at its new amount.
      const ledger = await as(admin).get(`/finance/ledger?from=${today()}&to=${today()}&q=UPI-REF-778899`).expect(200);
      expect(ledger.body.totals.expense).toBe('1300.00');
    });

    it('a notes-only edit changes no money and posts no new line', async () => {
      await as(admin).patch(`/finance/ledger/entries/${entryId}`, { reference: 'UPI-REF-778899-A' }).expect(200);
      const detail = await as(admin).get(`/finance/ledger/entries/${entryId}`).expect(200);
      expect(detail.body.lines).toHaveLength(3);
      expect(detail.body.reference).toBe('UPI-REF-778899-A');
    });

    it('reverses with a reason instead of deleting, and can restore', async () => {
      await as(admin).post(`/finance/ledger/entries/${entryId}/reverse`, {}).expect(400);
      const reversed = await as(admin).post(`/finance/ledger/entries/${entryId}/reverse`, { reason: 'Duplicate of bank statement entry' }).expect(200);
      expect(reversed.body.status).toBe('ARCHIVED');
      await as(admin).patch(`/finance/ledger/entries/${entryId}`, { amount: 5 }).expect(409);

      let ledger = await as(admin).get(`/finance/ledger?from=${today()}&to=${today()}&q=UPI-REF-778899`).expect(200);
      expect(ledger.body.totals.expense).toBe('0.00');

      await as(admin).post(`/finance/ledger/entries/${entryId}/restore`).expect(200);
      ledger = await as(admin).get(`/finance/ledger?from=${today()}&to=${today()}&q=UPI-REF-778899`).expect(200);
      expect(ledger.body.totals.expense).toBe('1300.00');

      const rows = await prisma.financeLedgerEntry.count({ where: { sourceType: 'MANUAL', sourceId: entryId } });
      expect(rows).toBe(5);
      const actions = (await prisma.auditLog.findMany({ where: { entityId: entryId }, orderBy: { occurredAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['ledger.manual_created', 'ledger.manual_updated', 'ledger.manual_updated', 'ledger.manual_reversed', 'ledger.manual_restored']);
    });

    it('records income the right way round', async () => {
      const income = await as(admin)
        .post('/finance/ledger/entries', { transactionDate: today(), type: 'CUSTOMER_PAYMENT', amount: 48000, description: 'Freight — Hubballi load', paymentMethod: 'CHEQUE', reference: 'CHQ 004512' })
        .expect(201);
      expect(income.body).toMatchObject({ direction: 'INCOME', paymentMethod: 'CHEQUE' });
    });

    it('searches by vehicle number and employee name', async () => {
      const byVehicle = await as(admin).get(`/finance/ledger?from=${today()}&to=${today()}&q=${encodeURIComponent(seed.vehicle.registrationNumber)}`).expect(200);
      expect(byVehicle.body.data.some((l: { manual: { id: string } | null }) => l.manual?.id === entryId)).toBe(true);
    });

    it('is for payroll roles only', async () => {
      await as(manager).post('/finance/ledger/entries', { transactionDate: today(), type: 'OTHER_EXPENSE', amount: 1, description: 'x' }).expect(403);
      await as(manager).get(`/finance/ledger/entries/${entryId}`).expect(403);
      await as(driver).patch(`/finance/ledger/entries/${entryId}`, { amount: 1 }).expect(403);
    });
  });

  describe('payments: proof, notes, filters', () => {
    let paymentId: string;
    let proofFileId: string;

    beforeAll(async () => {
      const payment = await as(admin)
        .post('/payments', { employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'CHEQUE', provider: 'MANUAL', amount: 2500, description: 'Night halt allowance', remarks: 'Belagavi trip' })
        .expect(201);
      paymentId = payment.body.id;
      expect(payment.body).toMatchObject({ method: 'CHEQUE', remarks: 'Belagavi trip', proof: null });
      const upload = await api().post(`${V}/files/documents`).set('Authorization', `Bearer ${admin}`).attach('file', pdf(), { filename: 'cheque-004513.pdf', contentType: 'application/pdf' }).expect(201);
      proofFileId = upload.body.fileId;
    });

    it('records a manual payment with its proof, and only payroll roles can read the proof', async () => {
      await as(admin).post(`/payments/${paymentId}/approve`).expect(200);
      const paid = await as(admin).post(`/payments/${paymentId}/record-manual`, { reference: 'CHQ 004513', paidOn: today(), proofFileId }).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', paymentReference: 'CHQ 004513', proof: { fileId: proofFileId, filename: 'cheque-004513.pdf', mimeType: 'application/pdf' } });

      const file = await as(admin).get(`/payments/${paymentId}/proof`).buffer(true).expect(200);
      expect(file.headers['content-type']).toContain('application/pdf');
      expect(file.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.from(file.body).toString('latin1')).toContain('%PDF-1.4');
      await as(manager).get(`/payments/${paymentId}/proof`).expect(403);
    });

    it('replaces a proof without losing the original', async () => {
      const second = await api().post(`${V}/files/documents`).set('Authorization', `Bearer ${admin}`).attach('file', pdf(), { filename: 'bank-advice.pdf', contentType: 'application/pdf' }).expect(201);
      const replaced = await as(admin).post(`/payments/${paymentId}/proof`, { fileId: second.body.fileId }).expect(200);
      expect(replaced.body.proof.fileId).toBe(second.body.fileId);
      expect(await prisma.storedFile.findUnique({ where: { id: proofFileId } })).toMatchObject({ deletedAt: null });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: paymentId, action: 'payment.proof_replaced' } });
      expect(audit.changes).toMatchObject({ previousProofFileId: proofFileId, proofFileId: second.body.fileId });
    });

    it('edits notes only, never money', async () => {
      const updated = await as(admin).patch(`/payments/${paymentId}`, { remarks: 'Cheque cleared 2 days later', amount: 1 }).expect(400);
      expect(updated.body.error).toBeDefined();
      const ok = await as(admin).patch(`/payments/${paymentId}`, { remarks: 'Cheque cleared 2 days later' }).expect(200);
      expect(ok.body).toMatchObject({ remarks: 'Cheque cleared 2 days later', amount: '2500.00' });
    });

    it('filters by date, method and search', async () => {
      const hit = await as(admin).get(`/payments?from=${today()}&to=${today()}&method=CHEQUE&q=CHQ%20004513`).expect(200);
      expect(hit.body.data.map((p: { id: string }) => p.id)).toEqual([paymentId]);
      const miss = await as(admin).get('/payments?from=2001-01-01&to=2001-01-31').expect(200);
      expect(miss.body.data).toHaveLength(0);
      await as(admin).get('/payments?from=2026-02-10&to=2026-02-01').expect(400);
    });

    it('refuses PhonePe and cheque-through-RazorpayX rather than pretending', async () => {
      await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'UPI', provider: 'PHONEPE', amount: 10 }).expect(400);
      await as(admin).post('/payments', { employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'CHEQUE', provider: 'RAZORPAYX', amount: 10 }).expect(400);
    });
  });

  describe('dashboard figures', () => {
    it('totals operational spend for the chosen period, for every office role', async () => {
      const day = await as(manager).get('/reports/dashboard/spend?preset=today').expect(200);
      expect(day.body.range).toMatchObject({ preset: 'today', from: today(), to: today() });
      expect(day.body).toHaveProperty('fuel.amount');
      expect(day.body).toHaveProperty('otherExpenses.amount');
      // Managers do not see ledger totals (they include payroll).
      expect(day.body).not.toHaveProperty('ledgerExpenses');

      const adminDay = await as(admin).get('/reports/dashboard/spend?preset=today').expect(200);
      expect(Number(adminDay.body.ledgerExpenses)).toBeGreaterThanOrEqual(1300 + 2500);

      const custom = await as(admin).get('/reports/dashboard/spend?from=2001-01-01&to=2001-01-31').expect(200);
      expect(custom.body).toMatchObject({ fuel: { amount: '0.00', entries: 0 }, operationalTotal: '0.00', ledgerExpenses: '0.00' });
      await as(admin).get('/reports/dashboard/spend?preset=this_fy').expect(200);
      await as(admin).get('/reports/dashboard/spend?preset=nonsense').expect(400);
    });

    it('counts payments by status group in the period, for payroll roles only', async () => {
      const res = await as(admin).get('/reports/dashboard/payments?preset=today').expect(200);
      expect(res.body.created.paid.count).toBeGreaterThanOrEqual(1);
      expect(Number(res.body.paidInPeriod.amount)).toBeGreaterThanOrEqual(2500);
      await as(manager).get('/reports/dashboard/payments?preset=today').expect(403);
    });
  });
});
