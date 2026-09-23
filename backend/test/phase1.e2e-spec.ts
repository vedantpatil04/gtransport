import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Phase 1 end-to-end flows: employees, driver profiles, vehicles, assignments and financing,
 * exercised through real HTTP against a real PostgreSQL database.
 */
describe('Phase 1 — employees, drivers and vehicles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let adminToken: string;
  let driverToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (identifier: string): Promise<string> => {
    const response = await api().post('/api/v1/auth/login').send({ identifier, password: TEST_PASSWORD }).expect(200);
    return response.body.accessToken as string;
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

  /** Creates an employee and returns its id. */
  const createEmployee = async (overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const response = await api()
      .post('/api/v1/employees')
      .set(auth(adminToken))
      .send({ fullName: 'Mahesh Naik', role: 'DRIVER', phone: '+919845000111', ...overrides })
      .expect(201);
    return response.body as Record<string, unknown>;
  };

  const createVehicle = async (overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const registration = `KA 22 QQ ${Math.floor(1000 + Math.random() * 8999)}`;
    const response = await api()
      .post('/api/v1/vehicles')
      .set(auth(adminToken))
      .send({ registrationNumber: registration, kind: 'TRUCK', fuelType: 'DIESEL', ...overrides })
      .expect(201);
    return response.body as Record<string, unknown>;
  };

  describe('employees', () => {
    it('creates an employee, allocating an employee code when none is given', async () => {
      const employee = await createEmployee({ fullName: 'Amit Pawar', role: 'MANAGER', department: 'Operations' });

      expect(employee).toMatchObject({ fullName: 'Amit Pawar', role: 'MANAGER', status: 'ACTIVE', department: 'Operations' });
      expect(employee.employeeCode).toEqual(expect.any(String));
      expect(employee.driver).toBeNull();
    });

    it('rejects a duplicate employee code', async () => {
      const employee = await createEmployee({ employeeCode: `DUP-${Date.now()}` });
      await api()
        .post('/api/v1/employees')
        .set(auth(adminToken))
        .send({ fullName: 'Clash', role: 'OTHER', employeeCode: employee.employeeCode })
        .expect(409);
    });

    it('validates the payload and names the offending fields', async () => {
      const response = await api()
        .post('/api/v1/employees')
        .set(auth(adminToken))
        .send({ fullName: '', role: 'PILOT', uan: '123' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(response.body.error.details)).toMatch(/role/);
    });

    it('updates an employee and records PF details', async () => {
      const employee = await createEmployee();
      const response = await api()
        .patch(`/api/v1/employees/${employee.id}`)
        .set(auth(adminToken))
        .send({ pfApplicable: true, uan: '100200300999', designation: 'Senior Driver' })
        .expect(200);

      expect(response.body).toMatchObject({ designation: 'Senior Driver' });
      expect(response.body.payroll).toMatchObject({ pfApplicable: true, uan: '100200300999' });
    });

    it('deactivates rather than deletes, and stands the driver profile down with it', async () => {
      const employee = await createEmployee({ fullName: 'Leaving Soon' });
      const driver = await api()
        .post('/api/v1/drivers')
        .set(auth(adminToken))
        .send({ employeeId: employee.id })
        .expect(201);

      await api()
        .patch(`/api/v1/employees/${employee.id}/status`)
        .set(auth(adminToken))
        .send({ status: 'INACTIVE', reason: 'Resigned' })
        .expect(200);

      const after = await api().get(`/api/v1/drivers/${driver.body.id}`).set(auth(adminToken)).expect(200);
      expect(after.body.status).toBe('INACTIVE');
      expect(after.body.employee.status).toBe('INACTIVE');

      // The record still exists: nothing was destroyed.
      await api().get(`/api/v1/employees/${employee.id}`).set(auth(adminToken)).expect(200);
    });

    it('searches by name and filters by role and status', async () => {
      const unique = `Zarina ${Date.now()}`;
      await createEmployee({ fullName: unique, role: 'ACCOUNTING' });

      const byName = await api().get('/api/v1/employees').query({ q: unique }).set(auth(adminToken)).expect(200);
      expect(byName.body.data).toHaveLength(1);
      expect(byName.body.data[0].fullName).toBe(unique);

      const byRole = await api().get('/api/v1/employees').query({ role: 'ACCOUNTING' }).set(auth(adminToken)).expect(200);
      expect(byRole.body.data.every((e: { role: string }) => e.role === 'ACCOUNTING')).toBe(true);

      const byStatus = await api().get('/api/v1/employees').query({ status: 'ACTIVE' }).set(auth(adminToken)).expect(200);
      expect(byStatus.body.data.every((e: { status: string }) => e.status === 'ACTIVE')).toBe(true);
    });

    it('paginates with a cursor instead of returning everything', async () => {
      const first = await api().get('/api/v1/employees').query({ limit: 2 }).set(auth(adminToken)).expect(200);
      expect(first.body.data.length).toBeLessThanOrEqual(2);

      if (first.body.page.nextCursor) {
        const second = await api()
          .get('/api/v1/employees')
          .query({ limit: 2, cursor: first.body.page.nextCursor })
          .set(auth(adminToken))
          .expect(200);
        const firstIds = first.body.data.map((e: { id: string }) => e.id);
        expect(second.body.data.some((e: { id: string }) => firstIds.includes(e.id))).toBe(false);
      }
    });
  });

  describe('driver profiles', () => {
    it('attaches a driver profile to an existing employee and never duplicates the person', async () => {
      const employee = await createEmployee({ fullName: 'Ganesh Jadhav', role: 'OTHER' });
      const driver = await api()
        .post('/api/v1/drivers')
        .set(auth(adminToken))
        .send({ employeeId: employee.id, licenceNumber: 'KA22 20140001111', homeTown: 'Kolhapur' })
        .expect(201);

      expect(driver.body.employee.id).toBe(employee.id);
      expect(driver.body.driverCode).toMatch(/^GR-D-/);

      // Creating the profile aligns the employee's business role.
      const refreshed = await api().get(`/api/v1/employees/${employee.id}`).set(auth(adminToken)).expect(200);
      expect(refreshed.body.role).toBe('DRIVER');

      // The same employee cannot become a second driver.
      await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(409);

      const employees = await api().get('/api/v1/employees').query({ q: 'Ganesh Jadhav' }).set(auth(adminToken)).expect(200);
      expect(employees.body.data).toHaveLength(1);
    });

    it('refuses to activate a driver whose employment is not active', async () => {
      const employee = await createEmployee({ fullName: 'Suspended Person' });
      const driver = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(201);
      await api().patch(`/api/v1/employees/${employee.id}/status`).set(auth(adminToken)).send({ status: 'SUSPENDED' }).expect(200);

      const response = await api()
        .patch(`/api/v1/drivers/${driver.body.id}/status`)
        .set(auth(adminToken))
        .send({ status: 'ACTIVE' })
        .expect(400);
      expect(response.body.error.message).toMatch(/not an active employee/i);
    });

    it('exposes PF data to admins on the driver profile', async () => {
      const response = await api().get(`/api/v1/drivers/${seed.driver.id}`).set(auth(adminToken)).expect(200);
      expect(response.body.pf).toMatchObject({ applicable: true, uan: '100200300400' });
    });

    it('summarises the driver documents for the profile screen', async () => {
      const response = await api().get(`/api/v1/drivers/${seed.driver.id}/documents/summary`).set(auth(adminToken)).expect(200);
      expect(response.body).toMatchObject({ licenceOnFile: true });
      expect(response.body.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('vehicles', () => {
    it('creates a vehicle with a normalised registration and rejects a duplicate', async () => {
      const registration = `KA 22 RR ${Math.floor(1000 + Math.random() * 8999)}`;
      const vehicle = await api()
        .post('/api/v1/vehicles')
        .set(auth(adminToken))
        .send({ registrationNumber: registration.toLowerCase(), kind: 'LCV', fuelType: 'PETROL', make: 'Tata', model: 'Ace Gold' })
        .expect(201);

      expect(vehicle.body.registrationNumber).toBe(registration.toUpperCase());
      expect(vehicle.body.ownership).toBe('OWNED');
      expect(vehicle.body.financing).toBeNull();

      await api()
        .post('/api/v1/vehicles')
        .set(auth(adminToken))
        .send({ registrationNumber: registration, kind: 'LCV', fuelType: 'PETROL' })
        .expect(409);
    });

    it('rejects a registration that is not a plate', async () => {
      await api()
        .post('/api/v1/vehicles')
        .set(auth(adminToken))
        .send({ registrationNumber: 'not-a-plate!', kind: 'LCV', fuelType: 'PETROL' })
        .expect(400);
    });

    it('searches and filters by registration, ownership and status', async () => {
      const vehicle = await createVehicle({ make: 'Eicher' });
      const found = await api()
        .get('/api/v1/vehicles')
        .query({ q: vehicle.registrationNumber as string })
        .set(auth(adminToken))
        .expect(200);
      expect(found.body.data.map((v: { id: string }) => v.id)).toContain(vehicle.id);

      const owned = await api().get('/api/v1/vehicles').query({ ownership: 'OWNED' }).set(auth(adminToken)).expect(200);
      expect(owned.body.data.every((v: { ownership: string }) => v.ownership === 'OWNED')).toBe(true);

      const active = await api().get('/api/v1/vehicles').query({ status: 'ACTIVE' }).set(auth(adminToken)).expect(200);
      expect(active.body.data.every((v: { status: string }) => v.status === 'ACTIVE')).toBe(true);
    });

    it('deactivates a vehicle rather than deleting it', async () => {
      const vehicle = await createVehicle();
      const response = await api()
        .patch(`/api/v1/vehicles/${vehicle.id}/status`)
        .set(auth(adminToken))
        .send({ status: 'IDLE', reason: 'Off road' })
        .expect(200);

      expect(response.body.status).toBe('IDLE');
      await api().get(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).expect(200);
    });
  });

  describe('ownership and financing', () => {
    it('keeps financing off an owned vehicle', async () => {
      const vehicle = await createVehicle();
      const response = await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({ lenderName: 'Shriram Finance', loanAmount: 500000, tenureMonths: 48, interestRatePct: 11.25 })
        .expect(400);

      expect(response.body.error.message).toMatch(/FINANCED/);
    });

    it('records loan terms for a financed vehicle and derives the EMI', async () => {
      const vehicle = await createVehicle();
      await api().patch(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).send({ ownership: 'FINANCED' }).expect(200);

      const response = await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({
          lenderName: 'Shriram Finance',
          loanAccountNumber: 'SF-VL-0001',
          loanAmount: 520000,
          downPayment: 120000,
          tenureMonths: 48,
          interestRatePct: 11.25,
          paidInstallments: 18,
          financeStartDate: '2025-01-10',
          status: 'ACTIVE',
        })
        .expect(200);

      expect(response.body.financing).toMatchObject({ lenderName: 'Shriram Finance', status: 'ACTIVE', tenureMonths: 48 });
      expect(Number(response.body.financing.calculated.emiAmount)).toBeCloseTo(13502.89, 1);
      expect(response.body.financing.remainingInstallments).toBe(30);
      expect(Number(response.body.financing.outstandingAmount)).toBeGreaterThan(0);
    });

    it('rejects impossible loan figures', async () => {
      const vehicle = await createVehicle();
      await api().patch(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).send({ ownership: 'FINANCED' }).expect(200);

      await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({ loanAmount: -5000, interestRatePct: 150 })
        .expect(400);

      const tooManyPaid = await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({ loanAmount: 100000, tenureMonths: 12, interestRatePct: 10, totalInstallments: 12, paidInstallments: 20 })
        .expect(400);
      expect(tooManyPaid.body.error.message).toMatch(/exceed/i);
    });

    it('will not mark a vehicle fully owned while a loan is still active', async () => {
      const vehicle = await createVehicle();
      await api().patch(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).send({ ownership: 'FINANCED' }).expect(200);
      await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({ loanAmount: 200000, tenureMonths: 24, interestRatePct: 10, status: 'ACTIVE' })
        .expect(200);

      await api().patch(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).send({ ownership: 'OWNED' }).expect(400);

      // Closing the loan first is what makes the change legitimate.
      await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({ status: 'COMPLETED' })
        .expect(200);
      const owned = await api().patch(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).send({ ownership: 'OWNED' }).expect(200);

      // A fully owned vehicle reports no financing at all, so no EMI card can be rendered.
      expect(owned.body.ownership).toBe('OWNED');
      expect(owned.body.financing).toBeNull();
    });
  });

  describe('driver ↔ vehicle assignment', () => {
    it('assigns a driver, then reassigns and keeps the history', async () => {
      const vehicle = await createVehicle();
      const firstEmployee = await createEmployee({ fullName: 'First Driver' });
      const secondEmployee = await createEmployee({ fullName: 'Second Driver' });
      const first = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: firstEmployee.id }).expect(201);
      const second = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: secondEmployee.id }).expect(201);

      await api()
        .post(`/api/v1/vehicles/${vehicle.id}/assignment`)
        .set(auth(adminToken))
        .send({ driverId: first.body.id })
        .expect(201);

      const reassigned = await api()
        .post(`/api/v1/vehicles/${vehicle.id}/assignment`)
        .set(auth(adminToken))
        .send({ driverId: second.body.id, notes: 'Route change' })
        .expect(201);
      expect(reassigned.body.isCurrent).toBe(true);
      expect(reassigned.body.driver.id).toBe(second.body.id);

      const history = await api().get(`/api/v1/vehicles/${vehicle.id}/assignments`).set(auth(adminToken)).expect(200);
      expect(history.body.data).toHaveLength(2);

      const closed = history.body.data.find((a: { driver: { id: string } }) => a.driver.id === first.body.id);
      expect(closed).toMatchObject({ isCurrent: false, endReason: 'vehicle_reassigned' });
      expect(closed.endedAt).not.toBeNull();

      // The vehicle reports the new driver; the previous driver is free again.
      const vehicleNow = await api().get(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).expect(200);
      expect(vehicleNow.body.currentAssignment.driver.id).toBe(second.body.id);
      const firstNow = await api().get(`/api/v1/drivers/${first.body.id}`).set(auth(adminToken)).expect(200);
      expect(firstNow.body.currentAssignment).toBeNull();
    });

    it('moves a driver between vehicles, closing the previous assignment', async () => {
      const employee = await createEmployee({ fullName: 'Moving Driver' });
      const driver = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(201);
      const vehicleA = await createVehicle();
      const vehicleB = await createVehicle();

      await api().post(`/api/v1/vehicles/${vehicleA.id}/assignment`).set(auth(adminToken)).send({ driverId: driver.body.id }).expect(201);
      await api().post(`/api/v1/vehicles/${vehicleB.id}/assignment`).set(auth(adminToken)).send({ driverId: driver.body.id }).expect(201);

      const a = await api().get(`/api/v1/vehicles/${vehicleA.id}`).set(auth(adminToken)).expect(200);
      const b = await api().get(`/api/v1/vehicles/${vehicleB.id}`).set(auth(adminToken)).expect(200);
      expect(a.body.currentAssignment).toBeNull();
      expect(b.body.currentAssignment.driver.id).toBe(driver.body.id);

      const driverHistory = await api().get(`/api/v1/drivers/${driver.body.id}/assignments`).set(auth(adminToken)).expect(200);
      expect(driverHistory.body.data).toHaveLength(2);
      expect(driverHistory.body.data.filter((x: { isCurrent: boolean }) => x.isCurrent)).toHaveLength(1);
    });

    it('unassigns a driver and refuses to unassign twice', async () => {
      const vehicle = await createVehicle();
      const employee = await createEmployee({ fullName: 'Temp Driver' });
      const driver = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(201);
      await api().post(`/api/v1/vehicles/${vehicle.id}/assignment`).set(auth(adminToken)).send({ driverId: driver.body.id }).expect(201);

      const ended = await api().delete(`/api/v1/vehicles/${vehicle.id}/assignment`).set(auth(adminToken)).send({}).expect(200);
      expect(ended.body.isCurrent).toBe(false);

      await api().delete(`/api/v1/vehicles/${vehicle.id}/assignment`).set(auth(adminToken)).send({}).expect(400);
    });

    it('will not assign a vehicle to a driver who is not active', async () => {
      const vehicle = await createVehicle();
      const employee = await createEmployee({ fullName: 'On Leave Driver' });
      const driver = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(201);
      await api().patch(`/api/v1/drivers/${driver.body.id}/status`).set(auth(adminToken)).send({ status: 'ON_LEAVE' }).expect(200);

      const response = await api()
        .post(`/api/v1/vehicles/${vehicle.id}/assignment`)
        .set(auth(adminToken))
        .send({ driverId: driver.body.id })
        .expect(400);
      expect(response.body.error.message).toMatch(/on_leave/i);
    });

    it('releases the vehicle when a driver is stood down', async () => {
      const vehicle = await createVehicle();
      const employee = await createEmployee({ fullName: 'Stood Down Driver' });
      const driver = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(201);
      await api().post(`/api/v1/vehicles/${vehicle.id}/assignment`).set(auth(adminToken)).send({ driverId: driver.body.id }).expect(201);

      await api().patch(`/api/v1/drivers/${driver.body.id}/status`).set(auth(adminToken)).send({ status: 'SUSPENDED' }).expect(200);

      const after = await api().get(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).expect(200);
      expect(after.body.currentAssignment).toBeNull();

      const history = await api().get(`/api/v1/drivers/${driver.body.id}/assignments`).set(auth(adminToken)).expect(200);
      expect(history.body.data[0]).toMatchObject({ isCurrent: false, endReason: 'driver_deactivated' });
    });

    it('filters vehicles and drivers by whether they are assigned', async () => {
      const unassigned = await api().get('/api/v1/vehicles').query({ assigned: 0 }).set(auth(adminToken)).expect(200);
      expect(unassigned.body.data.every((v: { currentAssignment: unknown }) => v.currentAssignment === null)).toBe(true);

      const assignedDrivers = await api().get('/api/v1/drivers').query({ assigned: 1 }).set(auth(adminToken)).expect(200);
      expect(assignedDrivers.body.data.every((d: { currentAssignment: unknown }) => d.currentAssignment !== null)).toBe(true);
    });

    it('refuses an assignment across companies', async () => {
      const otherCompany = await seedCompany(prisma);
      const vehicle = await createVehicle();

      await api()
        .post(`/api/v1/vehicles/${vehicle.id}/assignment`)
        .set(auth(adminToken))
        .send({ driverId: otherCompany.driver.id })
        .expect(404);
    });
  });

  describe('authorization', () => {
    it('keeps drivers out of employee, vehicle and assignment management', async () => {
      await api().get('/api/v1/employees').set(auth(driverToken)).expect(403);
      await api().post('/api/v1/employees').set(auth(driverToken)).send({ fullName: 'X', role: 'OTHER' }).expect(403);
      await api().get('/api/v1/vehicles').set(auth(driverToken)).expect(403);
      await api()
        .post(`/api/v1/vehicles/${seed.vehicle.id}/assignment`)
        .set(auth(driverToken))
        .send({ driverId: seed.driver.id })
        .expect(403);
    });

    it('requires authentication for every Phase 1 endpoint', async () => {
      await api().get('/api/v1/employees').expect(401);
      await api().get('/api/v1/vehicles').expect(401);
      await api().get(`/api/v1/drivers/${seed.driver.id}/assignments`).expect(401);
    });

    it('lets a driver read their own profile only', async () => {
      const me = await api().get('/api/v1/drivers/me').set(auth(driverToken)).expect(200);
      expect(me.body.id).toBe(seed.driver.id);
      await api().get(`/api/v1/drivers/${seed.otherDriver.id}`).set(auth(driverToken)).expect(403);
    });
  });

  describe('audit trail', () => {
    it('records every important action with the acting user', async () => {
      const employee = await createEmployee({ fullName: 'Audited Person' });
      const driver = await api().post('/api/v1/drivers').set(auth(adminToken)).send({ employeeId: employee.id }).expect(201);
      const vehicle = await createVehicle();
      await api().post(`/api/v1/vehicles/${vehicle.id}/assignment`).set(auth(adminToken)).send({ driverId: driver.body.id }).expect(201);
      await api().delete(`/api/v1/vehicles/${vehicle.id}/assignment`).set(auth(adminToken)).send({}).expect(200);
      await api().patch(`/api/v1/vehicles/${vehicle.id}`).set(auth(adminToken)).send({ ownership: 'FINANCED' }).expect(200);
      await api()
        .put(`/api/v1/vehicles/${vehicle.id}/financing`)
        .set(auth(adminToken))
        .send({ lenderName: 'HDFC Bank', loanAccountNumber: 'SECRET-123', loanAmount: 100000, tenureMonths: 12, interestRatePct: 9 })
        .expect(200);

      const actions = await prisma.auditLog.findMany({
        where: { companyId: seed.company.id, actorUserId: seed.admin.id },
        select: { action: true, changes: true },
      });
      const names = actions.map((a) => a.action);

      expect(names).toEqual(
        expect.arrayContaining([
          'employee.created',
          'driver.created',
          'vehicle.created',
          'assignment.created',
          'assignment.ended',
          'vehicle.ownership_changed',
          'vehicle.financing_updated',
        ]),
      );

      // Loan account numbers never reach the audit trail.
      expect(JSON.stringify(actions)).not.toMatch(/SECRET-123/);
    });
  });
});
