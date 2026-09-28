import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, TEST_PASSWORD } from './app-fixture';
import { PasswordHasher } from '../src/modules/auth/password-hasher';

describe('Driver Identity and Role Enforcement Acceptance Test (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let driverAUser: { phone: string; name: string; vehicleReg: string };
  let driverBUser: { phone: string; name: string; vehicleReg: string; driverId: string };

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = rawPrisma();
    app = await createTestApp();

    const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
    const hasher = new PasswordHasher();
    const passwordHash = await hasher.hash(TEST_PASSWORD);

    // Create company
    const company = await prisma.company.create({ data: { name: `Acceptance Company ${stamp}` } });

    // Driver A setup
    const empA = await prisma.employee.create({
      data: { companyId: company.id, employeeCode: `DRV-A-${stamp}`, fullName: 'Driver A Ramesh', preferredLanguage: 'EN' },
    });
    const drvA = await prisma.driver.create({
      data: { companyId: company.id, employeeId: empA.id, driverCode: `GR-A-${stamp.slice(-4)}` },
    });
    const phoneA = `+9191${stamp.slice(-8)}`;
    await prisma.user.create({
      data: { companyId: company.id, employeeId: empA.id, phone: phoneA, role: UserRole.DRIVER, passwordHash },
    });
    const vehA = await prisma.vehicle.create({
      data: { companyId: company.id, registrationNumber: `KA 22 AA ${stamp.slice(-4)}`, kind: 'LCV', fuelType: 'PETROL' },
    });
    const assignA = await prisma.vehicleAssignment.create({
      data: { companyId: company.id, vehicleId: vehA.id, driverId: drvA.id, startedAt: new Date() },
    });
    await prisma.vehicle.update({ where: { id: vehA.id }, data: { currentAssignmentId: assignA.id } });
    await prisma.driver.update({ where: { id: drvA.id }, data: { currentAssignmentId: assignA.id } });

    // Document for Driver A
    await prisma.document.create({
      data: { companyId: company.id, type: 'DRIVING_LICENCE', ownerType: 'EMPLOYEE', employeeId: empA.id, documentNumber: `DL-A-${stamp}` },
    });

    driverAUser = { phone: phoneA, name: 'Driver A Ramesh', vehicleReg: vehA.registrationNumber };

    // Driver B setup
    const empB = await prisma.employee.create({
      data: { companyId: company.id, employeeCode: `DRV-B-${stamp}`, fullName: 'Driver B Suresh', preferredLanguage: 'KN' },
    });
    const drvB = await prisma.driver.create({
      data: { companyId: company.id, employeeId: empB.id, driverCode: `GR-B-${stamp.slice(-4)}` },
    });
    const phoneB = `+9192${stamp.slice(-8)}`;
    await prisma.user.create({
      data: { companyId: company.id, employeeId: empB.id, phone: phoneB, role: UserRole.DRIVER, passwordHash },
    });
    const vehB = await prisma.vehicle.create({
      data: { companyId: company.id, registrationNumber: `KA 22 BB ${stamp.slice(-4)}`, kind: 'TRUCK', fuelType: 'DIESEL' },
    });
    const assignB = await prisma.vehicleAssignment.create({
      data: { companyId: company.id, vehicleId: vehB.id, driverId: drvB.id, startedAt: new Date() },
    });
    await prisma.vehicle.update({ where: { id: vehB.id }, data: { currentAssignmentId: assignB.id } });
    await prisma.driver.update({ where: { id: drvB.id }, data: { currentAssignmentId: assignB.id } });

    // Document for Driver B
    await prisma.document.create({
      data: { companyId: company.id, type: 'DRIVING_LICENCE', ownerType: 'EMPLOYEE', employeeId: empB.id, documentNumber: `DL-B-${stamp}` },
    });

    driverBUser = { phone: phoneB, name: 'Driver B Suresh', vehicleReg: vehB.registrationNumber, driverId: drvB.id };
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('proves Driver A and Driver B see their own identities, vehicles, and data, and cannot access each other data', async () => {
    // ── 1. Login as Driver A ──
    const loginA = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: driverAUser.phone, password: TEST_PASSWORD })
      .expect(200);

    const tokenA = loginA.body.accessToken;
    expect(loginA.body.user.role).toBe('DRIVER');

    // ── 2. Verify Driver A name and vehicle appear ──
    const profileA = await api()
      .get('/api/v1/drivers/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(profileA.body.employee.fullName).toBe(driverAUser.name);
    expect(profileA.body.currentAssignment.vehicle.registrationNumber).toBe(driverAUser.vehicleReg);
    expect(profileA.body.employee.preferredLanguage).toBe('EN');

    // ── 3. Verify Driver A CANNOT access Driver B data by changing an ID ──
    // Driver A attempting to access Driver B by ID on office driver endpoint must be forbidden
    await api()
      .get(`/api/v1/drivers/${driverBUser.driverId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    // Driver A attempting to list all drivers must be forbidden
    await api()
      .get('/api/v1/drivers')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    // Driver A attempting to list vehicles or employees must be forbidden
    await api()
      .get('/api/v1/vehicles')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    await api()
      .get('/api/v1/employees')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    // ── 4. Verify Driver A sees only Driver A documents ──
    const docsA = await api()
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(docsA.body.data.length).toBe(1);
    expect(docsA.body.data[0].documentNumber).toContain('DL-A-');

    // ── 5. Logout Driver A (client clears session) ──

    // ── 6. Login as Driver B ──
    const loginB = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: driverBUser.phone, password: TEST_PASSWORD })
      .expect(200);

    const tokenB = loginB.body.accessToken;
    expect(loginB.body.user.role).toBe('DRIVER');

    // ── 7. Verify Driver B name and vehicle appear ──
    const profileB = await api()
      .get('/api/v1/drivers/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(profileB.body.employee.fullName).toBe(driverBUser.name);
    expect(profileB.body.currentAssignment.vehicle.registrationNumber).toBe(driverBUser.vehicleReg);
    expect(profileB.body.employee.preferredLanguage).toBe('KN');

    // Verify Driver B sees DIFFERENT data from Driver A
    expect(profileB.body.employee.fullName).not.toBe(driverAUser.name);
    expect(profileB.body.currentAssignment.vehicle.registrationNumber).not.toBe(driverAUser.vehicleReg);

    // ── 8. Verify Driver B sees only Driver B documents ──
    const docsB = await api()
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(docsB.body.data.length).toBe(1);
    expect(docsB.body.data[0].documentNumber).toContain('DL-B-');
    expect(docsB.body.data[0].documentNumber).not.toBe(docsA.body.data[0].documentNumber);
  });
});
