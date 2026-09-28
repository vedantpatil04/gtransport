import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { todayInIndia, toIsoDate } from '../src/common/dates/financial-year';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Phase 3 end-to-end: fuel and daily operations through real HTTP against real PostgreSQL.
 */
describe('Phase 3 — fuel and daily operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let adminToken: string;
  let driverToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = toIsoDate(todayInIndia());
  const uniqueKey = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const login = async (identifier: string) =>
    (await api().post('/api/v1/auth/login').send({ identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;

  const fuel = (overrides: Record<string, unknown> = {}) => ({
    fuelType: 'DIESEL',
    amount: 2450,
    litres: 25,
    fuelStation: 'IndianOil',
    transactionDate: today,
    ...overrides,
  });

  /** A second driver who can log in but has no vehicle assigned. */
  const driverWithoutVehicle = async (): Promise<string> => {
    const stamp = Date.now();
    const employee = await prisma.employee.create({
      data: { companyId: seed.company.id, employeeCode: `NV-${stamp}`, fullName: 'Unassigned Driver', role: 'DRIVER' },
    });
    await prisma.driver.create({ data: { companyId: seed.company.id, employeeId: employee.id, driverCode: `GR-D-NV${stamp % 100000}` } });
    const phone = `+9170${String(stamp).slice(-8)}`;
    await prisma.user.create({
      data: {
        companyId: seed.company.id,
        employeeId: employee.id,
        phone,
        role: 'DRIVER',
        passwordHash: await new PasswordHasher().hash(TEST_PASSWORD),
      },
    });
    return login(phone);
  };

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();
    adminToken = await login(seed.admin.identifier);
    driverToken = await login(seed.driver.identifier);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('driver fuel entry', () => {
    it('links the driver and assigned vehicle automatically and derives the rate', async () => {
      const response = await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel()).expect(201);

      expect(response.body).toMatchObject({
        fuelType: 'DIESEL',
        amount: '2450.00',
        litres: '25.000',
        ratePerLitre: '98.00',
        fuelStation: 'IndianOil',
        transactionDate: today,
        status: 'ACTIVE',
      });
      expect(response.body.driver.id).toBe(seed.driver.id);
      expect(response.body.vehicle.id).toBe(seed.vehicle.id);
    });

    it('refuses a vehicle or driver supplied by the app', async () => {
      await api()
        .post('/api/v1/fuel/mine')
        .set(auth(driverToken))
        .send(fuel({ vehicleId: seed.vehicle.id, driverId: seed.otherDriver.id }))
        .expect(400);
    });

    it('validates the required fields and names them', async () => {
      const response = await api()
        .post('/api/v1/fuel/mine')
        .set(auth(driverToken))
        .send({ fuelType: 'KEROSENE', amount: 0, litres: -1, fuelStation: '', transactionDate: '19 Sep 2026' })
        .expect(400);

      const detail = JSON.stringify(response.body.error.details);
      for (const field of ['fuelType', 'amount', 'litres', 'fuelStation', 'transactionDate']) {
        expect(detail).toContain(field);
      }
    });

    it('rejects a future date and an impossible date', async () => {
      await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ transactionDate: '2099-01-01' })).expect(400);
      await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ transactionDate: '2026-02-31' })).expect(400);
    });

    it('accepts a back-dated fill-up', async () => {
      const response = await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ transactionDate: '2026-04-02' })).expect(201);
      expect(response.body.transactionDate).toBe('2026-04-02');
    });

    it('explains when no vehicle is assigned', async () => {
      const token = await driverWithoutVehicle();
      const response = await api().post('/api/v1/fuel/mine').set(auth(token)).send(fuel()).expect(400);
      expect(response.body.error.message).toMatch(/no vehicle/i);
    });
  });

  describe('duplicate prevention', () => {
    it('stores a retried submission exactly once', async () => {
      const clientSubmissionId = uniqueKey('fuel');
      const first = await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ clientSubmissionId })).expect(201);
      const retry = await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ clientSubmissionId })).expect(200);

      expect(retry.body.id).toBe(first.body.id);
      expect(await prisma.fuelEntry.count({ where: { clientSubmissionId } })).toBe(1);
    });

    it('stores simultaneous retries exactly once', async () => {
      const clientSubmissionId = uniqueKey('race');
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ clientSubmissionId }))),
      );

      expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(await prisma.fuelEntry.count({ where: { clientSubmissionId } })).toBe(1);
    });

    it('does not let one driver replay another driver\'s submission id', async () => {
      const clientSubmissionId = uniqueKey('owned');
      await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ clientSubmissionId })).expect(201);

      const other = await driverWithoutVehicle();
      await api().post('/api/v1/fuel/mine').set(auth(other)).send(fuel({ clientSubmissionId })).expect(403);
    });
  });

  describe('receipts', () => {
    const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`receipt-${Date.now()}-${Math.random()}`)]);

    it('uploads a receipt, attaches it, and lets the office open it', async () => {
      const upload = await api()
        .post('/api/v1/files/receipts')
        .set(auth(driverToken))
        .attach('file', jpeg(), { filename: 'receipt.jpg', contentType: 'image/jpeg' })
        .expect(201);
      const fileId = upload.body.fileId as string;

      const entry = await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ receiptFileId: fileId })).expect(201);
      expect(entry.body.receiptFileId).toBe(fileId);

      const opened = await api().get(`/api/v1/files/${fileId}/content`).set(auth(adminToken)).expect(200);
      expect(opened.headers['content-type']).toMatch(/image\/jpeg/);
      expect(opened.headers['cache-control']).toMatch(/no-store/);

      // The bytes live in file storage; PostgreSQL holds metadata only.
      const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
      expect(row).toMatchObject({ mimeType: 'image/jpeg', uploadedById: seed.driver.userId });
      expect(Object.keys(row)).not.toContain('bytes');
    });

    it('returns the same file when an upload is retried', async () => {
      const bytes = jpeg();
      const first = await api().post('/api/v1/files/receipts').set(auth(driverToken)).attach('file', bytes, { filename: 'r.jpg', contentType: 'image/jpeg' }).expect(201);
      const second = await api().post('/api/v1/files/receipts').set(auth(driverToken)).attach('file', bytes, { filename: 'r.jpg', contentType: 'image/jpeg' }).expect(201);

      expect(second.body).toMatchObject({ fileId: first.body.fileId, deduplicated: true });
    });

    it('refuses file types that are not receipts', async () => {
      await api()
        .post('/api/v1/files/receipts')
        .set(auth(driverToken))
        .attach('file', Buffer.from('#!/bin/sh'), { filename: 'script.sh', contentType: 'application/x-sh' })
        .expect(400);
    });

    it('will not attach a receipt uploaded by someone else', async () => {
      const upload = await api().post('/api/v1/files/receipts').set(auth(adminToken)).attach('file', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
      await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ receiptFileId: upload.body.fileId })).expect(400);
    });

    it("keeps a driver out of another person's receipt", async () => {
      const upload = await api().post('/api/v1/files/receipts').set(auth(adminToken)).attach('file', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
      await api().get(`/api/v1/files/${upload.body.fileId}/content`).set(auth(driverToken)).expect(403);
    });
  });

  describe('driver fuel history', () => {
    it('lists only the driver\'s own entries with totals for the range', async () => {
      const response = await api().get('/api/v1/fuel/mine').query({ from: today, to: today }).set(auth(driverToken)).expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.every((e: { driver: { id: string } }) => e.driver.id === seed.driver.id)).toBe(true);
      expect(Number(response.body.totals.amount)).toBeGreaterThan(0);
    });

    it('suggests stations the driver has used, without restricting them', async () => {
      const response = await api().get('/api/v1/fuel/mine/stations').set(auth(driverToken)).expect(200);
      expect(response.body).toContain('IndianOil');
    });

    it('keeps drivers out of the office fuel endpoints', async () => {
      await api().get('/api/v1/fuel').set(auth(driverToken)).expect(403);
      await api().get('/api/v1/fuel/summary').set(auth(driverToken)).expect(403);
    });
  });

  describe('office fuel review and statements', () => {
    it('summarises today, the month and the current financial year', async () => {
      const response = await api().get('/api/v1/fuel/summary').set(auth(adminToken)).expect(200);

      expect(response.body.financialYear.label).toMatch(/^FY \d{4}–\d{2}$/);
      expect(Number(response.body.today.amount)).toBeGreaterThan(0);
      expect(response.body.today.byFuelType).toHaveProperty('PETROL');
      expect(response.body.today.byFuelType).toHaveProperty('DIESEL');
    });

    it('computes the statement average as total amount ÷ total litres', async () => {
      // A dedicated vehicle and driver so the arithmetic is isolated from other tests.
      const isolated = await seedCompany(prisma);
      const token = await login(isolated.driver.identifier);
      const officeToken = await login(isolated.admin.identifier);

      await api().post('/api/v1/fuel/mine').set(auth(token)).send(fuel({ amount: 1100, litres: 10, fuelType: 'PETROL' })).expect(201);
      await api().post('/api/v1/fuel/mine').set(auth(token)).send(fuel({ amount: 8000, litres: 100, fuelType: 'DIESEL' })).expect(201);

      const statement = await api().get('/api/v1/fuel').query({ from: today, to: today }).set(auth(officeToken)).expect(200);

      expect(statement.body.totals).toMatchObject({ entries: 2, amount: '9100.00', litres: '110.000', averageRate: '82.73' });
    });

    it('filters the financial-year statement by 1 April – 31 March', async () => {
      const isolated = await seedCompany(prisma);
      const token = await login(isolated.driver.identifier);
      const officeToken = await login(isolated.admin.identifier);

      // 31 March belongs to the previous year; 1 April starts the new one.
      await api().post('/api/v1/fuel/mine').set(auth(token)).send(fuel({ transactionDate: '2026-03-31', amount: 100, litres: 1 })).expect(201);
      await api().post('/api/v1/fuel/mine').set(auth(token)).send(fuel({ transactionDate: '2026-04-01', amount: 200, litres: 2 })).expect(201);

      const fy2627 = await api().get('/api/v1/fuel').query({ fy: '2026-27' }).set(auth(officeToken)).expect(200);
      const fy2526 = await api().get('/api/v1/fuel').query({ fy: '2025-26' }).set(auth(officeToken)).expect(200);

      expect(fy2627.body.data.map((e: { transactionDate: string }) => e.transactionDate)).toContain('2026-04-01');
      expect(fy2627.body.data.map((e: { transactionDate: string }) => e.transactionDate)).not.toContain('2026-03-31');
      expect(fy2526.body.data.map((e: { transactionDate: string }) => e.transactionDate)).toContain('2026-03-31');

      await api().get('/api/v1/fuel').query({ fy: '2026-29' }).set(auth(officeToken)).expect(400);
    });

    it('filters by driver, vehicle, fuel type and station', async () => {
      const byVehicle = await api().get('/api/v1/fuel').query({ vehicleId: seed.vehicle.id }).set(auth(adminToken)).expect(200);
      expect(byVehicle.body.data.every((e: { vehicle: { id: string } }) => e.vehicle.id === seed.vehicle.id)).toBe(true);

      const diesel = await api().get('/api/v1/fuel').query({ fuelType: 'DIESEL' }).set(auth(adminToken)).expect(200);
      expect(diesel.body.data.every((e: { fuelType: string }) => e.fuelType === 'DIESEL')).toBe(true);

      const station = await api().get('/api/v1/fuel').query({ station: 'indian' }).set(auth(adminToken)).expect(200);
      expect(station.body.data.every((e: { fuelStation: string }) => /indian/i.test(e.fuelStation))).toBe(true);
    });

    it('breaks fuel down by vehicle', async () => {
      const response = await api().get('/api/v1/fuel/breakdown').query({ by: 'vehicle' }).set(auth(adminToken)).expect(200);
      const row = response.body.find((r: { key: string }) => r.key === seed.vehicle.id);
      expect(row.label).toBe(seed.vehicle.registrationNumber);
      expect(Number(row.averageRate)).toBeGreaterThan(0);
    });

    it('corrects an entry and records the before and after in the audit trail', async () => {
      const entry = await api().post('/api/v1/fuel/mine').set(auth(driverToken)).send(fuel({ amount: 1000, litres: 10 })).expect(201);

      const updated = await api().patch(`/api/v1/fuel/${entry.body.id}`).set(auth(adminToken)).send({ amount: 1200 }).expect(200);
      expect(updated.body).toMatchObject({ amount: '1200.00', ratePerLitre: '120.00' });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: entry.body.id, action: 'fuel.updated' } });
      // JSONB does not preserve key order, so assert on structure rather than text.
      expect(audit.changes).toMatchObject({ before: { amount: '1000.00' }, after: { amount: '1200.00' } });
    });

    it('archives rather than deletes, and archived entries leave the totals', async () => {
      const isolated = await seedCompany(prisma);
      const token = await login(isolated.driver.identifier);
      const officeToken = await login(isolated.admin.identifier);
      const entry = await api().post('/api/v1/fuel/mine').set(auth(token)).send(fuel({ amount: 500, litres: 5 })).expect(201);

      await api().post(`/api/v1/fuel/${entry.body.id}/archive`).set(auth(officeToken)).send({}).expect(400);
      await api().post(`/api/v1/fuel/${entry.body.id}/archive`).set(auth(officeToken)).send({ reason: 'Duplicate paper entry' }).expect(200);

      const active = await api().get('/api/v1/fuel').set(auth(officeToken)).expect(200);
      expect(active.body.totals.entries).toBe(0);

      const archived = await api().get('/api/v1/fuel').query({ status: 'ARCHIVED' }).set(auth(officeToken)).expect(200);
      expect(archived.body.data[0]).toMatchObject({ id: entry.body.id, archiveReason: 'Duplicate paper entry' });

      // The row still exists in the database.
      expect(await prisma.fuelEntry.count({ where: { id: entry.body.id } })).toBe(1);

      await api().post(`/api/v1/fuel/${entry.body.id}/restore`).set(auth(officeToken)).expect(200);
      const restored = await api().get('/api/v1/fuel').set(auth(officeToken)).expect(200);
      expect(restored.body.totals.entries).toBe(1);
    });

    it('never shows another company\'s fuel', async () => {
      const other = await seedCompany(prisma);
      const otherDriver = await login(other.driver.identifier);
      const foreign = await api().post('/api/v1/fuel/mine').set(auth(otherDriver)).send(fuel()).expect(201);

      await api().get(`/api/v1/fuel/${foreign.body.id}`).set(auth(adminToken)).expect(404);
      const list = await api().get('/api/v1/fuel').set(auth(adminToken)).expect(200);
      expect(list.body.data.map((e: { id: string }) => e.id)).not.toContain(foreign.body.id);
    });
  });

  describe('RTO, tyre and maintenance', () => {
    it.each(['RTO', 'TYRE', 'MAINTENANCE'])('records a %s expense against the assigned vehicle', async (category) => {
      const response = await api()
        .post('/api/v1/operations/mine')
        .set(auth(driverToken))
        .send({ category, amount: 18500, expenseDate: today, vendorName: 'Belagavi Service Centre', description: 'Oil + filter' })
        .expect(201);

      expect(response.body).toMatchObject({ category, amount: '18500.00', expenseDate: today });
      expect(response.body.vehicle.id).toBe(seed.vehicle.id);
      expect(response.body.driver.id).toBe(seed.driver.id);
    });

    it('does not accept the removed prototype categories', async () => {
      for (const category of ['PARKING', 'FOOD', 'REPAIR']) {
        await api().post('/api/v1/operations/mine').set(auth(driverToken)).send({ category, amount: 100, expenseDate: today }).expect(400);
      }
    });

    it('requires a positive amount and a date', async () => {
      await api().post('/api/v1/operations/mine').set(auth(driverToken)).send({ category: 'RTO', amount: 0, expenseDate: today }).expect(400);
      await api().post('/api/v1/operations/mine').set(auth(driverToken)).send({ category: 'RTO', amount: 100 }).expect(400);
    });

    it('stores a retried expense exactly once', async () => {
      const clientSubmissionId = uniqueKey('op');
      const body = { category: 'TYRE', amount: 9000, expenseDate: today, clientSubmissionId };
      const first = await api().post('/api/v1/operations/mine').set(auth(driverToken)).send(body).expect(201);
      const retry = await api().post('/api/v1/operations/mine').set(auth(driverToken)).send(body).expect(200);
      expect(retry.body.id).toBe(first.body.id);
    });

    it('gives the vehicle a service history the office can filter', async () => {
      const response = await api()
        .get('/api/v1/operations')
        .query({ vehicleId: seed.vehicle.id, category: 'MAINTENANCE' })
        .set(auth(adminToken))
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.every((r: { category: string }) => r.category === 'MAINTENANCE')).toBe(true);
      expect(Number(response.body.total)).toBeGreaterThan(0);
    });

    it('totals operations by vehicle', async () => {
      const response = await api().get('/api/v1/operations/breakdown').query({ by: 'vehicle', category: 'TYRE' }).set(auth(adminToken)).expect(200);
      expect(response.body.find((r: { key: string }) => r.key === seed.vehicle.id)?.label).toBe(seed.vehicle.registrationNumber);
    });

    it('lets the office record an expense for any company vehicle', async () => {
      const response = await api()
        .post('/api/v1/operations')
        .set(auth(adminToken))
        .send({ category: 'TYRE', amount: 21000, expenseDate: today, vehicleId: seed.vehicle.id, vendorName: 'MRF Tyres' })
        .expect(201);
      expect(response.body.driver).toBeNull();
    });
  });

  describe('tyre insurance', () => {
    it('records a policy as a TYRE_INSURANCE document on the vehicle, ready for expiry tracking', async () => {
      const response = await api()
        .post('/api/v1/operations/mine/tyre-insurance')
        .set(auth(driverToken))
        .send({ insurer: 'ICICI Lombard', policyNumber: 'TY-88231', premium: 3200, startDate: '2026-04-01', expiryDate: '2027-03-31' })
        .expect(201);

      expect(response.body).toMatchObject({ insurer: 'ICICI Lombard', premium: '3200.00', expiryDate: '2027-03-31' });
      expect(response.body.vehicle.id).toBe(seed.vehicle.id);

      const document = await prisma.document.findUniqueOrThrow({ where: { id: response.body.id } });
      expect(document).toMatchObject({ type: 'TYRE_INSURANCE', ownerType: 'VEHICLE', vehicleId: seed.vehicle.id });
    });

    it('requires the expiry date and an insurer', async () => {
      await api().post('/api/v1/operations/mine/tyre-insurance').set(auth(driverToken)).send({ insurer: 'ICICI Lombard' }).expect(400);
      await api().post('/api/v1/operations/mine/tyre-insurance').set(auth(driverToken)).send({ expiryDate: '2027-03-31' }).expect(400);
    });

    it('rejects a start date after the expiry date', async () => {
      await api()
        .post('/api/v1/operations/mine/tyre-insurance')
        .set(auth(driverToken))
        .send({ insurer: 'X', startDate: '2027-05-01', expiryDate: '2027-03-31' })
        .expect(400);
    });

    it('is listed for the vehicle', async () => {
      const response = await api().get('/api/v1/operations/tyre-insurance').query({ vehicleId: seed.vehicle.id }).set(auth(adminToken)).expect(200);
      expect(response.body.some((p: { insurer: string }) => p.insurer === 'ICICI Lombard')).toBe(true);
    });
  });

  describe('audit trail', () => {
    it('records fuel and operation activity with the acting user', async () => {
      const actions = await prisma.auditLog.findMany({
        where: { companyId: seed.company.id, actorUserId: seed.driver.userId },
        select: { action: true },
      });
      const names = actions.map((a) => a.action);
      // Tyre insurance now goes through the central documents module (Phase 4).
      expect(names).toEqual(expect.arrayContaining(['fuel.created', 'operation.created', 'document.uploaded']));
    });
  });
});
