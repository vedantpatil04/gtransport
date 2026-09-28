import { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

describe('Gangamata API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let adminToken: string;
  let driverToken: string;

  const http = () => request(app.getHttpServer());

  const login = (identifier: string, password = TEST_PASSWORD) =>
    http().post('/api/v1/auth/login').send({ identifier, password });

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();

    adminToken = (await login(seed.admin.identifier)).body.accessToken;
    driverToken = (await login(seed.driver.identifier)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('health', () => {
    it('reports the database as up, without authentication', async () => {
      const response = await http().get('/health').expect(200);
      expect(response.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('sits outside the versioned prefix', async () => {
      await http().get('/api/v1/health').expect(404);
    });
  });

  describe('authentication', () => {
    it('issues a token for valid credentials', async () => {
      const response = await login(seed.admin.identifier).expect(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.expiresAt).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({ id: seed.admin.id, role: 'ADMIN' });
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const wrongPassword = await login(seed.admin.identifier, 'not-the-password').expect(401);
      const unknownUser = await login('nobody@e2e.test').expect(401);
      expect(wrongPassword.body.error.message).toEqual(unknownUser.body.error.message);
    });

    it('records both successful and failed logins in the audit trail', async () => {
      await login(seed.admin.identifier, 'wrong-password-here').expect(401);
      const actions = await prisma.auditLog.findMany({ where: { companyId: seed.company.id }, select: { action: true } });
      expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['auth.login', 'auth.login_failed']));
    });

    it('rejects requests with no, malformed, or invalid tokens', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', 'Basic abc').expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.token').expect(401);
    });

    it('returns the caller identity from /auth/me', async () => {
      const response = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
      expect(response.body).toMatchObject({ role: 'DRIVER', driverId: seed.driver.id, companyId: seed.company.id });
    });

    it('stops honouring tokens once the account is disabled', async () => {
      const { body } = await login(seed.driver.identifier).expect(200);
      await prisma.user.update({ where: { id: seed.driver.userId }, data: { status: 'DISABLED' } });
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${body.accessToken}`).expect(401);
      await prisma.user.update({ where: { id: seed.driver.userId }, data: { status: 'ACTIVE' } });
    });
  });

  describe('validation and error shape', () => {
    it('reports field-level problems in the documented envelope', async () => {
      const response = await http().post('/api/v1/auth/login').send({ identifier: 'x' }).expect(400);
      expect(response.body.error).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED', path: '/api/v1/auth/login' });
      expect(response.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['identifier', 'password']);
      expect(response.body.error.requestId).toBeDefined();
    });

    it('strips unknown properties rather than silently accepting them', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .send({ identifier: seed.admin.identifier, password: TEST_PASSWORD, role: 'SUPER_ADMIN' })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('echoes a caller-supplied request id', async () => {
      const response = await http().get('/health').set('X-Request-Id', 'trace-123').expect(200);
      expect(response.headers['x-request-id']).toBe('trace-123');
    });

    it('returns the same envelope for unknown routes', async () => {
      const response = await http().get('/api/v1/nope').expect(404);
      expect(response.body.error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });
  });

  describe('role-based access', () => {
    it('lets office roles list employees and vehicles', async () => {
      const employees = await http().get('/api/v1/employees').set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(employees.body.data.length).toBeGreaterThanOrEqual(3);
      expect(employees.body.page).toMatchObject({ limit: 25 });

      const vehicles = await http().get('/api/v1/vehicles').set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(vehicles.body.data[0]).toMatchObject({ registrationNumber: seed.vehicle.registrationNumber });
    });

    it('refuses drivers access to office endpoints', async () => {
      for (const path of ['/api/v1/employees', '/api/v1/vehicles', '/api/v1/drivers']) {
        const response = await http().get(path).set('Authorization', `Bearer ${driverToken}`).expect(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('exposes payroll data to ADMIN', async () => {
      const response = await http().get('/api/v1/employees').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const driverRow = response.body.data.find((e: { id: string }) => e.id === seed.driver.employeeId);
      expect(driverRow.payroll).toMatchObject({ baseSalary: '21000.00', pfApplicable: true });
    });

    it('validates pagination input', async () => {
      await http().get('/api/v1/employees?limit=500').set('Authorization', `Bearer ${adminToken}`).expect(400);
      await http().get('/api/v1/employees?cursor=not-a-uuid').set('Authorization', `Bearer ${adminToken}`).expect(400);
    });
  });

  describe('driver scoping', () => {
    it('returns the driver their own record from /drivers/me', async () => {
      const response = await http().get('/api/v1/drivers/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
      expect(response.body).toMatchObject({ id: seed.driver.id });
      expect(response.body.currentAssignment.vehicle).toMatchObject({ registrationNumber: seed.vehicle.registrationNumber });
    });

    it('shows a driver only their own and their vehicle documents', async () => {
      const response = await http().get('/api/v1/documents').set('Authorization', `Bearer ${driverToken}`).expect(200);
      const ids = response.body.data.map((d: { id: string }) => d.id);
      expect(ids).toEqual(expect.arrayContaining([seed.documents.ownLicence.id, seed.documents.vehicleInsurance.id]));
      expect(ids).not.toContain(seed.documents.otherLicence.id);
    });

    it('cannot widen its own scope through a query filter', async () => {
      const response = await http()
        .get(`/api/v1/documents?employeeId=${seed.otherDriver.employeeId}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('lets an admin see every document in the company', async () => {
      const response = await http().get('/api/v1/documents').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const ids = response.body.data.map((d: { id: string }) => d.id);
      expect(ids).toContain(seed.documents.otherLicence.id);
    });
  });

  describe('tenant isolation', () => {
    it('hides records belonging to another company', async () => {
      const other = await seedCompany(prisma);
      const response = await http().get('/api/v1/vehicles').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const ids = response.body.data.map((v: { id: string }) => v.id);
      expect(ids).not.toContain(other.vehicle.id);

      await http().get(`/api/v1/vehicles/${other.vehicle.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
    });
  });

  describe('database integrity rules', () => {
    it('keeps audit records immutable', async () => {
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { companyId: seed.company.id } });
      await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
      await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    });

    it('rejects a document whose owner does not match its owner type', async () => {
      await expect(
        prisma.document.create({
          data: { companyId: seed.company.id, type: 'INSURANCE', ownerType: 'VEHICLE', employeeId: seed.driver.employeeId },
        }),
      ).rejects.toThrow(/documents_owner_consistency/);
    });

    it('rejects an expiry date before the issue date', async () => {
      await expect(
        prisma.document.create({
          data: {
            companyId: seed.company.id,
            type: 'PUC',
            ownerType: 'VEHICLE',
            vehicleId: seed.vehicle.id,
            issueDate: new Date('2026-05-01'),
            expiryDate: new Date('2026-04-01'),
          },
        }),
      ).rejects.toThrow(/documents_date_order/);
    });

    it('rejects impossible coordinates', async () => {
      await expect(
        prisma.driverLocationPing.create({
          data: {
            companyId: seed.company.id,
            driverId: seed.driver.id,
            latitude: 99,
            longitude: 0,
            recordedAt: new Date(),
            // Required since Phase 6: every fix carries the device key that makes a retry safe.
            clientSubmissionId: `coords-${Date.now()}`,
          },
        }),
      ).rejects.toThrow(/coordinates_range/);
    });

    it('stores a fix only once however many times it is uploaded', async () => {
      const submissionId = `dup-${Date.now()}`;
      const fix = {
        companyId: seed.company.id,
        driverId: seed.driver.id,
        latitude: 15.85,
        longitude: 74.498,
        recordedAt: new Date(),
        clientSubmissionId: submissionId,
      };
      await prisma.driverLocationPing.create({ data: fix });
      await expect(prisma.driverLocationPing.create({ data: fix })).rejects.toThrow(/Unique constraint/);
    });

    it('allows only one open assignment per driver, even writing directly to the database', async () => {
      const second = await prisma.vehicle.create({
        data: { companyId: seed.company.id, registrationNumber: `KA 22 ZZ ${Date.now() % 10000}`, kind: 'LCV', fuelType: 'PETROL' },
      });

      // The seeded driver is already driving something; a second open row is refused.
      await expect(
        prisma.vehicleAssignment.create({
          data: { companyId: seed.company.id, vehicleId: second.id, driverId: seed.driver.id, startedAt: new Date() },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('allows only one open assignment per vehicle', async () => {
      const spare = await prisma.employee.create({
        data: { companyId: seed.company.id, employeeCode: `SPR-${Date.now()}`, fullName: 'Spare Driver' },
      });
      const spareDriver = await prisma.driver.create({
        data: { companyId: seed.company.id, employeeId: spare.id, driverCode: `GR-D-S${Date.now() % 100000}` },
      });

      await expect(
        prisma.vehicleAssignment.create({
          data: { companyId: seed.company.id, vehicleId: seed.vehicle.id, driverId: spareDriver.id, startedAt: new Date() },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('refuses to point a vehicle at an assignment belonging to a different vehicle', async () => {
      const other = await prisma.vehicle.create({
        data: { companyId: seed.company.id, registrationNumber: `KA 22 YY ${Date.now() % 10000}`, kind: 'LCV', fuelType: 'PETROL' },
      });
      const current = await prisma.vehicle.findUniqueOrThrow({
        where: { id: seed.vehicle.id },
        select: { currentAssignmentId: true },
      });

      await expect(
        prisma.vehicle.update({ where: { id: other.id }, data: { currentAssignmentId: current.currentAssignmentId } }),
      ).rejects.toThrow();
    });
  });
});
