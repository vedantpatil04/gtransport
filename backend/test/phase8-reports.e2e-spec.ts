import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { UserRole, type PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { todayInIndia, toIsoDate } from '../src/common/dates/financial-year';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Phase 8: Reports & Management, end to end — the real app and database.
 *
 * One isolated company is seeded with records whose totals are known by hand: fuel either side of
 * the financial-year boundary, archived rows that must not count, ledger reversals, every payment
 * state, a financed and an owned vehicle, verified and AI-only service records, and documents
 * that are valid, expiring, expired and missing. Each report is checked against those numbers.
 */
describe('Phase 8: reports & management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  const tokens: Record<'admin' | 'manager' | 'accountant' | 'driver', string> = { admin: '', manager: '', accountant: '', driver: '' };
  let v2: { id: string; registrationNumber: string };
  let rameshEmployeeId: string;

  const FY = '2025-26';
  const api = () => request(app.getHttpServer());
  const V = '/api/v1';
  const get = (who: keyof typeof tokens, url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${tokens[who]}`);
  const login = async (identifier: string) =>
    (await api().post(`${V}/auth/login`).send({ identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const today = todayInIndia();
  const plusDays = (n: number) => new Date(today.getTime() + n * 86_400_000);
  const at = (iso: string) => new Date(iso);

  /** Collects a binary response body (PDF, XLSX) as a Buffer. */
  const binary = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    const companyId = seed.company.id;
    const stamp = `${Date.now()}`.slice(-7);
    const hasher = new PasswordHasher();
    const passwordHash = await hasher.hash(TEST_PASSWORD);

    // Office roles beyond the seeded admin.
    for (const [role, key] of [[UserRole.MANAGER, 'manager'], [UserRole.ACCOUNTING, 'accountant']] as const) {
      const employee = await prisma.employee.create({ data: { companyId, employeeCode: `${key}-${stamp}`, fullName: `Test ${key}` } });
      await prisma.user.create({ data: { companyId, employeeId: employee.id, email: `${key}-${stamp}@e2e.test`, role, passwordHash } });
    }

    const ramesh = seed.driver.id;
    const other = seed.otherDriver.id;
    const v1 = seed.vehicle.id;
    rameshEmployeeId = seed.driver.employeeId;
    v2 = await prisma.vehicle.create({
      data: { companyId, registrationNumber: `KA 25 FN ${stamp.slice(-4)}`, kind: 'TRUCK', fuelType: 'DIESEL', ownership: 'FINANCED' },
      select: { id: true, registrationNumber: true },
    });

    // ── Fuel. FY 2025–26 total: 8000 + 600 + 2000 + 1000 = 11,600 over 115 L. ──
    const fuel = (vehicleId: string, driverId: string, fuelType: 'PETROL' | 'DIESEL', amount: string, litres: string, date: string, station: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') =>
      ({ companyId, vehicleId, driverId, fuelType, amount, litres, transactionDate: day(date), fuelStation: station, status, ...(status === 'ARCHIVED' ? { archivedAt: new Date(), archiveReason: 'Duplicate' } : {}) });
    await prisma.fuelEntry.createMany({
      data: [
        fuel(v1, ramesh, 'DIESEL', '8000.00', '80.000', '2025-06-10', 'IndianOil NH4'),
        fuel(v1, ramesh, 'DIESEL', '600.00', '5.000', '2025-06-12', 'HP Hubli'),
        fuel(v2.id, other, 'PETROL', '2000.00', '20.000', '2025-11-01', 'IndianOil NH4'),
        fuel(v2.id, other, 'DIESEL', '1000.00', '10.000', '2026-03-31', 'Bharat Petroleum'), // last day of the FY: in
        fuel(v2.id, other, 'DIESEL', '777.00', '7.000', '2025-03-31', 'Bharat Petroleum'), // last day of the previous FY: out
        fuel(v1, ramesh, 'DIESEL', '555.00', '5.000', '2026-04-01', 'HP Hubli'), // first day of the next FY: out
        fuel(v1, ramesh, 'DIESEL', '9999.00', '99.000', '2025-07-01', 'IndianOil NH4', 'ARCHIVED'), // archived: out
      ],
    });

    // ── Vehicle expenses. Maintenance 9,500; tyre 12,000; RTO 2,500. ──
    await prisma.vehicleExpense.createMany({
      data: [
        { companyId, vehicleId: v1, driverId: ramesh, category: 'MAINTENANCE', amount: '5000.00', expenseDate: day('2025-08-01'), vendorName: 'Sri Garage', aiStatus: 'VERIFIED', aiVerifiedAt: new Date(), aiVerifiedById: seed.admin.id, serviceType: 'Oil change', invoiceNumber: 'INV-1' },
        { companyId, vehicleId: v1, driverId: ramesh, category: 'MAINTENANCE', amount: '3000.00', expenseDate: day('2025-12-01'), vendorName: 'Sri Garage', aiStatus: 'VERIFIED', aiVerifiedAt: new Date(), aiVerifiedById: seed.admin.id, serviceType: 'Oil change', invoiceNumber: 'INV-2' },
        // An AI reading nobody has verified: its service type must never be reported.
        { companyId, vehicleId: v2.id, driverId: null, category: 'MAINTENANCE', amount: '1500.00', expenseDate: day('2026-01-15'), vendorName: 'City Motors', aiStatus: 'NEEDS_REVIEW', serviceType: 'Brake pads' },
        { companyId, vehicleId: v1, driverId: ramesh, category: 'TYRE', amount: '12000.00', expenseDate: day('2025-09-01'), vendorName: 'MRF Tyres', description: '2 rear tyres' },
        { companyId, vehicleId: v2.id, driverId: null, category: 'RTO', amount: '2500.00', expenseDate: day('2025-10-10'), vendorName: 'RTO Hubli' },
        { companyId, vehicleId: v1, driverId: ramesh, category: 'MAINTENANCE', amount: '99999.00', expenseDate: day('2025-10-01'), status: 'ARCHIVED', archivedAt: new Date(), archiveReason: 'Duplicate' },
      ],
    });

    // ── Documents. Tyre insurance premium 1,800 dated in the FY, policy now expired. ──
    await prisma.document.createMany({
      data: [
        { companyId, type: 'TYRE_INSURANCE', ownerType: 'VEHICLE', vehicleId: v1, issuer: 'United India', documentNumber: 'TI-1', amount: '1800.00', issueDate: day('2025-09-05'), expiryDate: plusDays(-30), verificationStatus: 'VERIFIED' },
        { companyId, type: 'PUC', ownerType: 'VEHICLE', vehicleId: v1, documentNumber: 'PUC-1', expiryDate: plusDays(5), verificationStatus: 'VERIFIED' },
        { companyId, type: 'RC', ownerType: 'VEHICLE', vehicleId: v1, documentNumber: 'RC-1', verificationStatus: 'VERIFIED' },
        { companyId, type: 'INSURANCE', ownerType: 'VEHICLE', vehicleId: v2.id, documentNumber: 'INS-2', expiryDate: plusDays(-3) },
      ],
    });

    // ── Ledger: outflow 21,000 + 3,000 + 15,000 + 1,000 − 1,000 = 39,000; inflow 5,000. ──
    const line = (type: string, direction: 'INCOME' | 'EXPENSE', amount: string, date: string, extra: object = {}) =>
      ({ companyId, type: type as never, direction, amount, transactionDate: day(date), sourceType: 'MANUAL' as const, sourceId: randomUUID(), ...extra });
    await prisma.financeLedgerEntry.createMany({
      data: [
        line('SALARY', 'EXPENSE', '21000.00', '2025-07-31', { employeeId: rameshEmployeeId, description: 'Salary 2025-07' }),
        line('ADVANCE', 'EXPENSE', '3000.00', '2025-07-10', { employeeId: rameshEmployeeId }),
        line('EMI', 'EXPENSE', '15000.00', '2025-08-05', { vehicleId: v2.id, description: 'EMI 1 · HDFC' }),
        line('OTHER_INCOME', 'INCOME', '5000.00', '2025-09-01', { description: 'Scrap sale' }),
      ],
    });
    const original = await prisma.financeLedgerEntry.create({ data: line('FUEL', 'EXPENSE', '1000.00', '2025-10-01', { vehicleId: v1 }) });
    await prisma.financeLedgerEntry.create({
      data: { ...line('FUEL', 'EXPENSE', '-1000.00', '2025-10-02', { vehicleId: v1, description: 'Reversal' }), sourceId: original.sourceId, sequence: 2, reversalOfId: original.id },
    });

    // ── Payroll. Net payable 19,000 (21,000 + 1,000 − 3,000); a cancelled salary is excluded. ──
    const salary = await prisma.salaryRecord.create({
      data: { companyId, employeeId: rameshEmployeeId, payPeriod: day('2025-07-01'), baseSalary: '21000.00', allowances: '1000.00', advanceRecovery: '3000.00', deductions: '0', netPayable: '19000.00', status: 'PAID' },
    });
    const otherEmployeeId = (await prisma.driver.findUniqueOrThrow({ where: { id: other }, select: { employeeId: true } })).employeeId;
    await prisma.salaryRecord.create({
      data: { companyId, employeeId: otherEmployeeId, payPeriod: day('2025-08-01'), baseSalary: '15000.00', netPayable: '15000.00', status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Entered twice' },
    });
    await prisma.advance.create({ data: { companyId, employeeId: rameshEmployeeId, type: 'FUEL_ADVANCE', amount: '3000.00', advanceDate: day('2025-07-10'), status: 'PAID' } });

    // ── Payments: one of each state that matters. Only the PAID one is "paid". ──
    const payment = (type: 'SALARY' | 'ADVANCE' | 'OTHER' | 'ALLOWANCE', amount: string, status: string, createdAt: string, extra: object = {}) =>
      ({ companyId, employeeId: rameshEmployeeId, type, amount, status: status as never, method: 'BANK_TRANSFER' as const, provider: 'MANUAL' as const, createdAt: at(createdAt), ...extra });
    await prisma.paymentRecord.createMany({
      data: [
        payment('SALARY', '19000.00', 'PAID', '2025-07-31T06:00:00Z', { salaryRecordId: salary.id, paidAt: at('2025-08-01T06:00:00Z') }),
        payment('ADVANCE', '3000.00', 'REVERSED', '2025-07-10T06:00:00Z', { paidAt: at('2025-07-11T06:00:00Z'), reversedAt: at('2025-07-20T06:00:00Z') }),
        payment('OTHER', '500.00', 'STATUS_REVIEW_REQUIRED', '2025-09-10T06:00:00Z'),
        payment('ALLOWANCE', '700.00', 'PENDING_APPROVAL', '2025-09-12T06:00:00Z'),
      ],
    });

    // ── Vehicle finance on the financed vehicle: one EMI paid, one overdue, one in the future. ──
    const financing = await prisma.vehicleFinancing.create({
      data: { vehicleId: v2.id, status: 'ACTIVE', lenderName: 'HDFC', emiAmount: '15000.00', outstandingAmount: '300000.00', nextDueDate: day('2025-09-05') },
    });
    await prisma.vehicleFinanceInstallment.createMany({
      data: [
        { financingId: financing.id, installmentNumber: 1, dueDate: day('2025-08-05'), amount: '15000.00', status: 'PAID', paidAt: day('2025-08-05') },
        { financingId: financing.id, installmentNumber: 2, dueDate: day('2025-09-05'), amount: '15000.00', status: 'PENDING' },
        { financingId: financing.id, installmentNumber: 3, dueDate: plusDays(400), amount: '15000.00', status: 'PENDING' },
      ],
    });

    // ── Location: Ramesh tracking now; the other driver silent for days. One six-hour stop in the FY. ──
    const now = new Date();
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    await prisma.driverLocationState.createMany({
      data: [
        { driverId: ramesh, companyId, vehicleId: v1, status: 'ACTIVE', trackingState: 'TRACKING_ACTIVE', permission: 'GRANTED_ALWAYS', locationServicesEnabled: true, latitude: '15.364700', longitude: '75.124000', recordedAt: minutesAgo(1), receivedAt: minutesAgo(1), lastHeartbeatAt: minutesAgo(1) },
        { driverId: other, companyId, vehicleId: v2.id, status: 'OFFLINE', trackingState: 'TRACKING_ACTIVE', permission: 'GRANTED_ALWAYS', locationServicesEnabled: true, latitude: '15.000000', longitude: '75.000000', recordedAt: minutesAgo(5000), receivedAt: minutesAgo(5000), lastHeartbeatAt: minutesAgo(5000) },
      ],
    });
    await prisma.fleetLocationAlert.create({
      data: {
        companyId, driverId: ramesh, vehicleId: v1, status: 'RESOLVED', triggeredAt: at('2025-10-01T06:00:00Z'), stationarySince: at('2025-10-01T02:00:00Z'),
        latitude: '15.364700', longitude: '75.124000', durationMinutes: 240, radiusMeters: 150, movedAt: at('2025-10-01T08:00:00Z'), resolvedAt: at('2025-10-01T08:00:00Z'), resolvedReason: 'movement',
      },
    });
    await prisma.driverLocationPing.createMany({
      data: [5, 3, 1].map((m) => ({ companyId, driverId: ramesh, vehicleId: v1, latitude: '15.364700', longitude: '75.124000', recordedAt: minutesAgo(m), clientSubmissionId: `p8-${stamp}-${m}` })),
    });

    tokens.admin = await login(seed.admin.identifier);
    tokens.manager = await login(`manager-${stamp}@e2e.test`);
    tokens.accountant = await login(`accountant-${stamp}@e2e.test`);
    tokens.driver = await login(seed.driver.identifier);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  // ───────────────────────────── Access ─────────────────────────────

  describe('authorisation (server-side)', () => {
    const REPORTS = ['overview', 'fuel', 'vehicles', 'drivers', 'finance', 'expenses', 'maintenance', 'tyres', 'compliance', 'location'];

    it('requires a session', async () => {
      await api().get(`${V}/reports/fuel`).expect(401);
      await api().get(`${V}/reports/fuel/export?format=pdf`).expect(401);
    });

    it('gives a driver no admin report, summary, records or export', async () => {
      for (const report of REPORTS) await get('driver', `/reports/${report}`).expect(403);
      await get('driver', '/reports/fuel/records').expect(403);
      await get('driver', '/reports/fuel/export?format=csv').expect(403);
      await get('driver', '/reports/meta').expect(403);
    });

    it('lets an administrator open every report', async () => {
      for (const report of REPORTS) await get('admin', `/reports/${report}${report === 'compliance' ? '' : `?fy=${FY}`}`).expect(200);
      const meta = (await get('admin', '/reports/meta').expect(200)).body;
      expect(meta.reports).toEqual(REPORTS);
      expect(meta.currentFinancialYear.code).toMatch(/^\d{4}-\d{2}$/);
    });

    it('keeps finance and pay away from a manager — on screen and in exports', async () => {
      await get('manager', `/reports/finance?fy=${FY}`).expect(403);
      await get('manager', `/reports/finance/records?fy=${FY}`).expect(403);
      await get('manager', `/reports/finance/export?fy=${FY}&format=xlsx`).expect(403);
      await get('manager', `/reports/location?fy=${FY}`).expect(200);
      await get('manager', '/reports/compliance').expect(200);

      const overview = (await get('manager', `/reports/overview?fy=${FY}`).expect(200)).body;
      expect(overview.finance).toBeUndefined();
      expect(overview.compliance).toBeDefined();

      const drivers = (await get('manager', `/reports/drivers/records?fy=${FY}`).expect(200)).body;
      expect(drivers.data[0].payments).toBeUndefined();
      expect(drivers.data[0].location).toBeDefined();
      expect((await get('manager', '/reports/meta').expect(200)).body.reports).not.toContain('finance');
    });

    it('gives accounting finance and expenses, but not fleet location or compliance', async () => {
      await get('accountant', `/reports/finance?fy=${FY}`).expect(200);
      await get('accountant', `/reports/expenses?fy=${FY}`).expect(200);
      await get('accountant', `/reports/location?fy=${FY}`).expect(403);
      await get('accountant', '/reports/compliance').expect(403);
      await get('accountant', '/reports/compliance/export?format=pdf').expect(403);

      const overview = (await get('accountant', `/reports/overview?fy=${FY}`).expect(200)).body;
      expect(overview.finance).toBeDefined();
      expect(overview.compliance).toBeUndefined();
      expect(overview.location).toBeUndefined();

      const vehicles = (await get('accountant', `/reports/vehicles/records?fy=${FY}`).expect(200)).body;
      expect(vehicles.data[0].documents).toBeUndefined();
    });

    it('never reaches another company’s records', async () => {
      const other = await seedCompany(prisma);
      await prisma.fuelEntry.create({
        data: { companyId: other.company.id, vehicleId: other.vehicle.id, driverId: other.driver.id, fuelType: 'DIESEL', amount: '123456.00', litres: '1.000', transactionDate: day('2025-06-10'), fuelStation: 'Elsewhere' },
      });
      const fuel = (await get('admin', `/reports/fuel?fy=${FY}`).expect(200)).body;
      expect(fuel.totals.amount).toBe('11600.00');
      // Filtering by a vehicle of another company finds nothing rather than its data.
      const foreign = (await get('admin', `/reports/fuel?fy=${FY}&vehicleId=${other.vehicle.id}`).expect(200)).body;
      expect(foreign.totals.entries).toBe(0);
    });
  });

  // ───────────────────────────── Dates & validation ─────────────────────────────

  describe('dates and validation', () => {
    it('echoes the exact period, financial year and granularity', async () => {
      const body = (await get('admin', `/reports/fuel?fy=${FY}`).expect(200)).body;
      expect(body.range).toMatchObject({ preset: 'fy', from: '2025-04-01', to: '2026-03-31', granularity: 'month' });
      expect(body.range.financialYears).toEqual([{ code: '2025-26', label: 'FY 2025–26' }]);
      expect(body.trend).toHaveLength(12);
      expect(body.trend[0].bucket).toBe('2025-04');
    });

    it.each([
      ['from after to', '/reports/fuel?from=2025-09-30&to=2025-09-01', /on or before/],
      ['an impossible date', '/reports/fuel?from=2025-02-30&to=2025-03-01', /not a valid date/],
      ['a range over three years', '/reports/fuel?from=2020-01-01&to=2025-01-01', /three years or less/],
      ['a financial year not yet started', '/reports/fuel?fy=2099-00', /has not started/],
      ['an unknown preset', '/reports/fuel?preset=decade', /preset must be one of/],
      ['an unknown parameter', '/reports/fuel?fy=2025-26&orderBy=password', /should not exist/],
      ['a sort column outside the whitelist', '/reports/fuel/records?fy=2025-26&sort=passwordHash', /Cannot sort by/],
      ['a page size over the limit', '/reports/fuel/records?fy=2025-26&pageSize=500', /pageSize/],
      ['an unknown export format', '/reports/fuel/export?fy=2025-26&format=docx', /format must be/],
    ])('refuses %s with 400', async (_name, url, message) => {
      const res = await get('admin', url).expect(400);
      expect(JSON.stringify(res.body)).toMatch(message);
    });

    it('returns genuine zeros — with 200 — for a period with no records', async () => {
      const fuel = (await get('admin', '/reports/fuel?fy=2023-24').expect(200)).body;
      expect(fuel.totals).toEqual({ entries: 0, amount: '0.00', litres: '0.000', averageRate: null });
      expect(fuel.trend.every((b: { amount: string }) => b.amount === '0.00')).toBe(true);
      const records = (await get('admin', '/reports/fuel/records?fy=2023-24').expect(200)).body;
      expect(records.data).toEqual([]);
      expect(records.page.total).toBe(0);
    });
  });

  // ───────────────────────────── Reports ─────────────────────────────

  describe('fuel', () => {
    it('totals the financial year exactly, with a weighted rate', async () => {
      const body = (await get('admin', `/reports/fuel?fy=${FY}`).expect(200)).body;
      // In: 8000 + 600 + 2000 + 1000 (31 Mar). Out: 31 Mar previous FY, 1 Apr next FY, archived.
      expect(body.totals).toEqual({ entries: 4, amount: '11600.00', litres: '115.000', averageRate: '100.87' });
      expect(body.byFuelType.DIESEL).toMatchObject({ entries: 3, amount: '9600.00', litres: '95.000', averageRate: '101.05' });
      expect(body.byFuelType.PETROL).toMatchObject({ entries: 1, amount: '2000.00', averageRate: '100.00' });
      expect(body.highestSpendVehicle).toMatchObject({ id: seed.vehicle.id, amount: '8600.00' });
      expect(body.byStation.find((s: { label: string }) => s.label === 'IndianOil NH4').amount).toBe('10000.00');
    });

    it('combines filters', async () => {
      const q = `fy=${FY}&vehicleId=${seed.vehicle.id}&driverId=${seed.driver.id}&fuelType=DIESEL`;
      expect((await get('admin', `/reports/fuel?${q}`).expect(200)).body.totals).toMatchObject({ entries: 2, amount: '8600.00' });
      expect((await get('admin', `/reports/fuel?${q}&station=hp`).expect(200)).body.totals).toMatchObject({ entries: 1, amount: '600.00' });
      expect((await get('admin', `/reports/fuel?fy=${FY}&fuelType=PETROL&vehicleId=${seed.vehicle.id}`).expect(200)).body.totals.entries).toBe(0);
    });

    it('pages, sorts and searches records on the server', async () => {
      const first = (await get('admin', `/reports/fuel/records?fy=${FY}&pageSize=3&sort=amount&dir=asc`).expect(200)).body;
      expect(first.page).toEqual({ page: 1, pageSize: 3, total: 4, pageCount: 2 });
      expect(first.data.map((r: { amount: string }) => r.amount)).toEqual(['600.00', '1000.00', '2000.00']);
      expect(first.data[0]).toMatchObject({ rate: '120.00', station: 'HP Hubli', fuelType: 'DIESEL' });
      const second = (await get('admin', `/reports/fuel/records?fy=${FY}&pageSize=3&page=2&sort=amount&dir=asc`).expect(200)).body;
      expect(second.data.map((r: { amount: string }) => r.amount)).toEqual(['8000.00']);
      const search = (await get('admin', `/reports/fuel/records?fy=${FY}&q=bharat`).expect(200)).body;
      expect(search.page.total).toBe(1);
    });

    it('follows a custom range to the day, both ends inclusive', async () => {
      const body = (await get('admin', '/reports/fuel?from=2025-06-10&to=2025-06-12').expect(200)).body;
      expect(body.totals.amount).toBe('8600.00');
      expect(body.range.granularity).toBe('day');
      expect(body.trend.map((b: { bucket: string; amount: string }) => [b.bucket, b.amount])).toEqual([['2025-06-10', '8000.00'], ['2025-06-11', '0.00'], ['2025-06-12', '600.00']]);
    });
  });

  describe('expenses', () => {
    it('totals each production category from its own source', async () => {
      const body = (await get('admin', `/reports/expenses?fy=${FY}`).expect(200)).body;
      expect(body.total).toBe('37400.00');
      const amounts = Object.fromEntries(body.byCategory.map((c: { category: string; amount: string }) => [c.category, c.amount]));
      expect(amounts).toEqual({ FUEL: '11600.00', RTO: '2500.00', TYRE: '12000.00', TYRE_INSURANCE: '1800.00', MAINTENANCE: '9500.00' });
      // Prototype-only categories never appear.
      expect(Object.keys(amounts)).not.toEqual(expect.arrayContaining(['PARKING']));
    });

    it('lists every expense record across categories, paged and filterable', async () => {
      const all = (await get('admin', `/reports/expenses/records?fy=${FY}&pageSize=100`).expect(200)).body;
      expect(all.page.total).toBe(10);
      const insurance = (await get('admin', `/reports/expenses/records?fy=${FY}&category=TYRE_INSURANCE`).expect(200)).body;
      expect(insurance.data).toEqual([expect.objectContaining({ category: 'TYRE_INSURANCE', amount: '1800.00', date: '2025-09-05', vendor: 'United India' })]);
      // Tyre insurance belongs to a vehicle, so a driver filter leaves it out.
      const driver = (await get('admin', `/reports/expenses/records?fy=${FY}&driverId=${seed.driver.id}&pageSize=100`).expect(200)).body;
      expect(driver.data.every((r: { category: string }) => r.category !== 'TYRE_INSURANCE')).toBe(true);
      expect(driver.page.total).toBe(5);
      const largest = (await get('admin', `/reports/expenses/records?fy=${FY}&sort=amount&dir=desc&pageSize=1`).expect(200)).body;
      expect(largest.data[0]).toMatchObject({ category: 'TYRE', amount: '12000.00' });
      expect((await get('admin', `/reports/expenses/records?fy=${FY}&q=mrf`).expect(200)).body.page.total).toBe(1);
    });
  });

  describe('vehicles', () => {
    it('reports running cost per vehicle, with EMI only where a loan exists', async () => {
      const body = (await get('admin', `/reports/vehicles/records?fy=${FY}&sort=total`).expect(200)).body;
      const [first, second] = body.data;
      expect(first).toMatchObject({ id: seed.vehicle.id, operatingCost: '30400.00', otherExpenses: '21800.00', finance: null });
      expect(first.fuel).toMatchObject({ amount: '8600.00', litres: '85.000' });
      expect(first.documents).toEqual({ expired: 1, expiring: 1, missing: 2, health: 'EXPIRED' });
      expect(second).toMatchObject({ id: v2.id, operatingCost: '7000.00' });
      expect(second.finance).toMatchObject({ lender: 'HDFC', emiAmount: '15000.00', outstanding: '300000.00', paidInPeriod: '15000.00', dueInPeriod: '30000.00', overdueCount: 1 });

      const summary = (await get('admin', `/reports/vehicles?fy=${FY}`).expect(200)).body;
      expect(summary.totals.operatingCost).toBe('37400.00');
      expect(summary.highest.maintenance).toMatchObject({ label: seed.vehicle.registrationNumber, amount: '8000.00' });
      expect(summary.finance).toMatchObject({ financedVehicles: 1, outstanding: '300000.00', overdueInstallments: 1 });
    });
  });

  describe('drivers', () => {
    it('counts what each driver recorded — and pay only for payroll roles', async () => {
      const body = (await get('admin', `/reports/drivers/records?fy=${FY}`).expect(200)).body;
      const ramesh = body.data.find((r: { id: string }) => r.id === seed.driver.id);
      expect(ramesh).toMatchObject({ fuel: { entries: 2, amount: '8600.00', litres: '85.000' }, expenses: { entries: 3, amount: '20000.00' }, services: 2 });
      // Paid counts PAID only; the reversed advance is not paid, and open = review + pending approval.
      expect(ramesh.payments).toEqual({ paid: '19000.00', paidCount: 1, open: '1200.00', openCount: 2, failedCount: 0 });
      expect(ramesh.location).toMatchObject({ status: 'ACTIVE', stationaryAlerts: 1 });
    });
  });

  describe('finance', () => {
    it('summarises the ledger, payroll, payments and EMI from their own records', async () => {
      const body = (await get('admin', `/reports/finance?fy=${FY}`).expect(200)).body;
      expect(body.ledger).toMatchObject({ inflow: '5000.00', outflow: '39000.00', net: '-34000.00' });
      expect(body.salaries).toMatchObject({ count: 1, baseSalary: '21000.00', advanceRecovery: '3000.00', netPayable: '19000.00', cancelled: { count: 1, netPayable: '15000.00' } });
      expect(body.advances).toMatchObject({ count: 1, amount: '3000.00' });
      expect(body.payments.byGroup).toMatchObject({
        paid: { count: 1, amount: '19000.00' },
        reversed: { count: 1, amount: '3000.00' },
        processing: { count: 1, amount: '500.00' },
        pending: { count: 1, amount: '700.00' },
      });
      expect(body.payments.paidInPeriod).toEqual({ count: 1, amount: '19000.00' });
      expect(body.vehicleFinance).toMatchObject({ activeLoans: 1, outstanding: '300000.00', paidInPeriod: '15000.00', dueInPeriod: '30000.00', overdue: { count: 1, amount: '15000.00' } });
      expect(body.byEmployee[0]).toMatchObject({ id: rameshEmployeeId, salaryNet: '19000.00', advances: '3000.00' });
    });

    it('filters payments by status and lists ledger lines, reversals included', async () => {
      const paid = (await get('admin', `/reports/finance?fy=${FY}&paymentStatus=PAID`).expect(200)).body;
      expect(paid.payments.byGroup.reversed.count).toBe(0);
      const lines = (await get('admin', `/reports/finance/records?fy=${FY}&pageSize=100`).expect(200)).body;
      expect(lines.page.total).toBe(6);
      expect(lines.data.find((l: { isReversal: boolean }) => l.isReversal)).toMatchObject({ amount: '-1000.00', type: 'FUEL' });
      const emi = (await get('admin', `/reports/finance/records?fy=${FY}&type=EMI`).expect(200)).body;
      expect(emi.data).toEqual([expect.objectContaining({ amount: '15000.00', vehicle: { id: v2.id, registrationNumber: v2.registrationNumber } })]);
    });
  });

  describe('maintenance', () => {
    it('separates verified records from AI readings', async () => {
      const body = (await get('admin', `/reports/maintenance?fy=${FY}`).expect(200)).body;
      expect(body.totals).toEqual({ services: 3, amount: '9500.00' });
      expect(body.verification.verified).toEqual({ count: 2, amount: '8000.00' });
      expect(body.verification.awaitingVerification).toEqual({ count: 1, amount: '1500.00' });
      expect(body.pendingVerification.count).toBe(1);
      expect(body.recurring).toEqual([expect.objectContaining({ serviceType: 'Oil change', count: 2, amount: '8000.00' })]);
      const records = (await get('admin', `/reports/maintenance/records?fy=${FY}&vehicleId=${v2.id}`).expect(200)).body;
      // The AI read "Brake pads", but nobody verified it: it is not reported as fact.
      expect(records.data[0]).toMatchObject({ aiStatus: 'NEEDS_REVIEW', verified: false, serviceType: null });
    });
  });

  describe('tyres', () => {
    it('keeps tyre purchases and tyre insurance separate, and invents no tyre details', async () => {
      const body = (await get('admin', `/reports/tyres?fy=${FY}`).expect(200)).body;
      expect(body.expenses).toEqual({ entries: 1, amount: '12000.00' });
      expect(body.insurance).toEqual({ policies: 1, premiums: '1800.00' });
      expect(body.total).toBe('13800.00');
      expect(body.tyreDetailsRecorded).toBe(false);
      const policies = (await get('admin', `/reports/tyres/records?fy=${FY}&section=policies`).expect(200)).body;
      expect(policies.data[0]).toMatchObject({ insurer: 'United India', premium: '1800.00', health: 'EXPIRED' });
    });
  });

  describe('compliance', () => {
    it('reports document health as of today, with missing documents distinct from expired', async () => {
      const body = (await get('admin', '/reports/compliance').expect(200)).body;
      expect(body.range).toBeNull();
      // Held: 2 licences, V1 insurance/RC/PUC/tyre insurance, V2 insurance.
      expect(body.totals).toEqual({ documents: 7, valid: 4, expiring: 1, expired: 2, missing: 7, pendingVerification: 4 });
      const missing = (await get('admin', '/reports/compliance/records?status=MISSING&pageSize=100').expect(200)).body;
      expect(missing.page.total).toBe(7);
      expect(missing.data.every((i: { documentId: string | null }) => i.documentId === null)).toBe(true);
      const narrow = (await get('admin', '/reports/compliance?window=7&documentType=PUC').expect(200)).body;
      expect(narrow.totals).toMatchObject({ expiring: 1, missing: 1 });
      const vehicle = (await get('admin', `/reports/compliance/records?vehicleId=${v2.id}&status=EXPIRED`).expect(200)).body;
      expect(vehicle.data).toEqual([expect.objectContaining({ type: 'INSURANCE', health: 'EXPIRED', daysRemaining: -3 })]);
    });
  });

  describe('location', () => {
    it('summarises live tracking and stops without shipping raw positions', async () => {
      const fy = (await get('admin', `/reports/location?fy=${FY}`).expect(200)).body;
      expect(fy.tracking).toMatchObject({ drivers: 2, active: 1, offline: 1 });
      expect(fy.alerts).toMatchObject({ total: 1, resolved: 1, totalMinutes: 360, longestMinutes: 360 });
      // That financial year is older than raw-GPS retention: no fix counts are claimed for it.
      expect(fy.activity.coveredFrom).toBeNull();

      const recent = (await get('admin', '/reports/location?preset=today').expect(200)).body;
      expect(recent.activity.days.at(-1)).toMatchObject({ date: toIsoDate(today), fixes: 3, drivers: 1 });
      const alerts = (await get('admin', `/reports/location/records?fy=${FY}&section=alerts`).expect(200)).body;
      expect(alerts.data[0]).toMatchObject({ durationMinutes: 360, status: 'RESOLVED' });
      expect(JSON.stringify(recent)).not.toMatch(/latitude/);
    });
  });

  describe('overview', () => {
    it('agrees with the individual reports', async () => {
      const body = (await get('admin', `/reports/overview?fy=${FY}`).expect(200)).body;
      expect(body.spend).toMatchObject({ total: '37400.00', fuel: '11600.00', otherExpenses: '25800.00', maintenance: '9500.00', tyre: '12000.00', tyreInsurance: '1800.00' });
      expect(body.highlights.topExpenseVehicle).toMatchObject({ id: seed.vehicle.id, amount: '30400.00' });
      expect(body.highlights.highestMaintenanceVehicle).toMatchObject({ id: seed.vehicle.id, amount: '8000.00' });
      expect(body.finance).toMatchObject({ paymentsPaid: { count: 1, amount: '19000.00' }, emiPaid: { amount: '15000.00' }, ledgerOutflow: '39000.00' });
      expect(body.finance.paymentStatus.paid).toEqual({ count: 1, amount: '19000.00' });
      expect(body.compliance).toMatchObject({ expired: 2, missing: 7 });
      expect(body.fleet).toMatchObject({ vehicles: 2, activeDrivers: 2 });
      expect(body.comparisons.financialYearOverYear.previous.from).toMatch(/-04-01$/);
    });
  });

  // ───────────────────────────── Exports ─────────────────────────────

  describe('exports', () => {
    it('produces a real PDF named for its period', async () => {
      const res = await get('admin', `/reports/fuel/export?fy=${FY}&format=pdf`).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe('attachment; filename="gangamata-fuel-report-2025-04-01_2026-03-31.pdf"');
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.toString('latin1')).toMatch(/NotoSans/);
    });

    it('produces an Excel workbook containing exactly the filtered records', async () => {
      const res = await get('admin', `/reports/fuel/export?fy=${FY}&format=xlsx&vehicleId=${seed.vehicle.id}`).buffer(true).parse(binary).expect(200);
      expect(res.headers['x-report-rows']).toBe('2');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as never);
      expect(workbook.worksheets.map((s) => s.name)).toEqual(['Report', 'Summary', 'Fuel entries']);
      const meta = workbook.getWorksheet('Report')!.getSheetValues().flat().map(String);
      expect(meta).toContain(seed.vehicle.registrationNumber);
      expect(meta).toContain('FY 2025–26');
      const data = workbook.getWorksheet('Fuel entries')!;
      const amounts = [2, 3].map((r) => data.getRow(r).getCell(7).value).sort();
      expect(amounts).toEqual([600, 8000]);
      expect(data.getRow(4).getCell(7).value).toBe(8600); // totals row
    });

    it('produces CSV with every record of every category', async () => {
      const res = await get('admin', `/reports/expenses/export?fy=${FY}&format=csv`).expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
      expect(lines[0]).toBe('Date,Category,Vehicle,Driver,Vendor / station,Description,Amount (INR),Receipt');
      expect(lines).toHaveLength(11);
      expect(lines[1]!.startsWith('2025-06-10,Fuel,')).toBe(true);
    });

    it('exports every report an administrator can see, in every format', async () => {
      for (const report of ['overview', 'vehicles', 'drivers', 'finance', 'maintenance', 'tyres', 'compliance', 'location']) {
        for (const format of ['pdf', 'xlsx', 'csv']) {
          const url = `/reports/${report}/export?format=${format}${report === 'compliance' ? '' : `&fy=${FY}`}`;
          const res = await get('admin', url).buffer(true).parse(binary);
          expect([report, format, res.status]).toEqual([report, format, 200]);
          expect((res.body as Buffer).length).toBeGreaterThan(50);
        }
      }
    });

    it('records who exported what in the audit trail', async () => {
      await get('accountant', `/reports/finance/export?fy=${FY}&format=xlsx&paymentStatus=PAID`).buffer(true).parse(binary).expect(200);
      const entry = await prisma.auditLog.findFirst({ where: { companyId: seed.company.id, action: 'report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(entry).toMatchObject({ entityType: 'Report', actorRole: 'ACCOUNTING' });
      expect(entry?.metadata).toMatchObject({ report: 'finance', format: 'xlsx', period: { from: '2025-04-01', to: '2026-03-31' }, filters: [{ 'Payment status': 'Paid' }] });
    });

    it('refuses exports the role may not see, before building anything', async () => {
      const before = await prisma.auditLog.count({ where: { companyId: seed.company.id, action: 'report.exported' } });
      await get('manager', `/reports/finance/export?fy=${FY}&format=pdf`).expect(403);
      await get('accountant', `/reports/location/export?fy=${FY}&format=csv`).expect(403);
      await get('driver', `/reports/expenses/export?fy=${FY}&format=xlsx`).expect(403);
      expect(await prisma.auditLog.count({ where: { companyId: seed.company.id, action: 'report.exported' } })).toBe(before);
    });
  });
});
