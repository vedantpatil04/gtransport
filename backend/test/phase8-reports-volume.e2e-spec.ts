import type { INestApplication } from '@nestjs/common';
import type { OperationCategory, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Phase 8: reports at realistic volume.
 *
 * A year of a 50-vehicle fleet — 6,000 fuel entries, 6,000 vehicle expenses, a week of GPS fixes
 * (≈20,000) — and the reports must stay responsive with bounded payloads: aggregation happens in
 * PostgreSQL, record lists are one page at a time, and raw positions never leave the database.
 */
describe('Phase 8: reports at volume (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token = '';
  const FY = '2025-26';
  const FUEL = 6_000;
  const EXPENSES = 6_000;

  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`);
  const binary = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  };
  const timed = async (url: string, parse = false) => {
    const started = Date.now();
    const res = parse ? await get(url).buffer(true).parse(binary).expect(200) : await get(url).expect(200);
    return { res, ms: Date.now() - started, bytes: parse ? (res.body as Buffer).length : Buffer.byteLength(res.text ?? '') };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = rawPrisma();
    const seed = await seedCompany(prisma);
    const companyId = seed.company.id;
    const stamp = `${Date.now()}`.slice(-6);

    const vehicles = [seed.vehicle.id];
    for (let i = 1; i < 50; i += 1) {
      vehicles.push((await prisma.vehicle.create({ data: { companyId, registrationNumber: `KA 99 VL ${stamp}${i}`, kind: 'TRUCK', fuelType: 'DIESEL' }, select: { id: true } })).id);
    }
    const drivers = [seed.driver.id, seed.otherDriver.id];
    for (let i = 0; i < 18; i += 1) {
      const employee = await prisma.employee.create({ data: { companyId, employeeCode: `VOL-${stamp}-${i}`, fullName: `Volume Driver ${i}` } });
      drivers.push((await prisma.driver.create({ data: { companyId, employeeId: employee.id, driverCode: `VD-${stamp}-${i}` }, select: { id: true } })).id);
    }

    const start = Date.UTC(2025, 3, 1);
    const dayOf = (i: number) => new Date(start + (i % 365) * 86_400_000);
    const fuelRows = Array.from({ length: FUEL }, (_, i) => ({
      companyId, vehicleId: vehicles[i % vehicles.length]!, driverId: drivers[i % drivers.length]!, fuelType: (i % 4 ? 'DIESEL' : 'PETROL') as 'DIESEL' | 'PETROL',
      amount: (2000 + (i % 37) * 13.5).toFixed(2), litres: (20 + (i % 11)).toFixed(3), transactionDate: dayOf(i), fuelStation: `Station ${i % 40}`,
    }));
    for (let i = 0; i < fuelRows.length; i += 2_000) await prisma.fuelEntry.createMany({ data: fuelRows.slice(i, i + 2_000) });

    const categories: OperationCategory[] = ['RTO', 'TYRE', 'MAINTENANCE'];
    const expenseRows = Array.from({ length: EXPENSES }, (_, i) => ({
      companyId, vehicleId: vehicles[(i * 7) % vehicles.length]!, driverId: i % 3 ? drivers[i % drivers.length]! : null, category: categories[i % 3]!,
      amount: (500 + (i % 50) * 21).toFixed(2), expenseDate: dayOf(i * 3), vendorName: `Vendor ${i % 25}`,
    }));
    for (let i = 0; i < expenseRows.length; i += 2_000) await prisma.vehicleExpense.createMany({ data: expenseRows.slice(i, i + 2_000) });

    // About 20,000 fixes over the last six days, inside raw-GPS retention.
    const now = Date.now();
    const pings = Array.from({ length: 20_000 }, (_, i) => ({
      companyId, driverId: drivers[i % drivers.length]!, vehicleId: vehicles[i % vehicles.length]!, latitude: '15.364700', longitude: '75.124000',
      recordedAt: new Date(now - (i % 8_640) * 60_000), clientSubmissionId: `vol-${stamp}-${i}`,
    }));
    for (let i = 0; i < pings.length; i += 5_000) await prisma.driverLocationPing.createMany({ data: pings.slice(i, i + 5_000) });

    token = (await api().post('/api/v1/auth/login').send({ identifier: seed.admin.identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken;
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  it.each([
    ['overview', `/reports/overview?fy=${FY}`],
    ['fuel summary', `/reports/fuel?fy=${FY}`],
    ['expense summary', `/reports/expenses?fy=${FY}`],
    ['vehicle summary', `/reports/vehicles?fy=${FY}`],
    ['driver summary', `/reports/drivers?fy=${FY}`],
    ['maintenance summary', `/reports/maintenance?fy=${FY}`],
    ['finance summary', `/reports/finance?fy=${FY}`],
    ['location summary', '/reports/location?preset=this_week'],
  ])('%s aggregates on the server and stays small', async (_name, url) => {
    const { ms, bytes } = await timed(url);
    expect(ms).toBeLessThan(5_000);
    expect(bytes).toBeLessThan(250_000);
  });

  it('totals every record, not just a page', async () => {
    const { res } = await timed(`/reports/fuel?fy=${FY}`);
    expect(res.body.totals.entries).toBe(FUEL);
    const expenses = (await timed(`/reports/expenses?fy=${FY}&category=MAINTENANCE`)).res.body;
    expect(expenses.entries).toBe(EXPENSES / 3);
  });

  it.each([
    ['fuel', `/reports/fuel/records?fy=${FY}&pageSize=100&page=40&sort=amount`],
    ['expense register', `/reports/expenses/records?fy=${FY}&pageSize=100&page=80&sort=vehicle&dir=asc`],
    ['vehicles', `/reports/vehicles/records?fy=${FY}&pageSize=25&sort=total`],
    ['drivers', `/reports/drivers/records?fy=${FY}&pageSize=10`],
    ['maintenance', `/reports/maintenance/records?fy=${FY}&pageSize=100&page=10`],
  ])('%s records come one bounded page at a time', async (_name, url) => {
    const { res, ms } = await timed(url);
    expect(ms).toBeLessThan(5_000);
    expect(res.body.data.length).toBeLessThanOrEqual(res.body.page.pageSize);
    expect(res.body.page.total).toBeGreaterThan(res.body.data.length);
  });

  it('counts raw GPS fixes in the database without returning a single position', async () => {
    const { res, bytes } = await timed('/reports/location?preset=this_week');
    const fixes = res.body.activity.days.reduce((n: number, d: { fixes: number }) => n + d.fixes, 0);
    expect(fixes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(50_000);
  });

  it('exports a full year of fuel to Excel, and every expense to CSV, in reasonable time', async () => {
    const xlsx = await timed(`/reports/fuel/export?fy=${FY}&format=xlsx`, true);
    expect(xlsx.res.headers['x-report-rows']).toBe(String(FUEL));
    expect(xlsx.ms).toBeLessThan(30_000);
    const csv = await timed(`/reports/expenses/export?fy=${FY}&format=csv`, true);
    expect(csv.res.headers['x-report-rows']).toBe(String(FUEL + EXPENSES));
    // A PDF carries a stated excerpt, not 12,000 rows.
    const pdf = await timed(`/reports/expenses/export?fy=${FY}&format=pdf`, true);
    expect(pdf.res.headers['x-report-rows']).toBe('1000');
    expect(pdf.ms).toBeLessThan(30_000);
  }, 120_000);
});
