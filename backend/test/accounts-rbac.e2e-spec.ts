import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Production correction: accounts, RBAC and sessions, end to end against the real app and
 * database. Covers the account lifecycle (create → first sign-in → password change → suspend →
 * activate → disable → role change → reset), who may manage whom, employment knock-on effects,
 * tenant isolation, audit records, and a role-by-endpoint access matrix.
 */
describe('accounts & RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let other: Awaited<ReturnType<typeof seedCompany>>;
  let passwordHash: string;
  const tokens: Record<string, string> = {};
  let stamp = Date.now();

  const V = '/api/v1';
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => api().post(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => api().patch(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const login = (identifier: string, password = TEST_PASSWORD) => api().post(`${V}/auth/login`).send({ identifier, password });
  const tokenFor = async (identifier: string, password = TEST_PASSWORD) => (await login(identifier, password).expect(200)).body.accessToken as string;
  const uniqueMobile = () => `9${String((stamp += 1)).slice(-9)}`;

  /** An employee with a working login of the given role, created straight in the database. */
  const person = async (role: UserRole, companyId = seed.company.id) => {
    const n = (stamp += 1);
    const employee = await prisma.employee.create({
      data: { companyId, employeeCode: `T-${n}`, fullName: `${role} ${n}`, role: role === 'SUPER_ADMIN' ? 'ADMIN' : role === 'DRIVER' ? 'DRIVER' : role },
    });
    const email = `${role.toLowerCase()}-${n}@e2e.test`;
    const user = await prisma.user.create({ data: { companyId, employeeId: employee.id, email, role, passwordHash } });
    return { employee, user, email };
  };

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    other = await seedCompany(prisma);
    app = await createTestApp();
    passwordHash = (await prisma.user.findUniqueOrThrow({ where: { id: seed.admin.id } })).passwordHash;

    for (const role of ['SUPER_ADMIN', 'MANAGER', 'ACCOUNTING'] as const) {
      const p = await person(role);
      tokens[role] = await tokenFor(p.email);
    }
    tokens.ADMIN = await tokenFor(seed.admin.identifier);
    tokens.DRIVER = await tokenFor(seed.driver.identifier);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('authentication', () => {
    it('signs in and returns one profile for every role', async () => {
      const response = await login(seed.admin.identifier).expect(200);
      expect(response.body.user).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, displayName: 'Office Admin' });
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|sessionVersion/);
    });

    it('answers a wrong password and an unknown account identically', async () => {
      const wrong = await login(seed.admin.identifier, 'not-the-password').expect(401);
      const unknown = await login('nobody@e2e.test', 'not-the-password').expect(401);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('restores the session from /auth/me', async () => {
      const response = await as(tokens.MANAGER).get('/auth/me').expect(200);
      expect(response.body).toMatchObject({ role: 'MANAGER', status: 'ACTIVE', mustChangePassword: false });
    });

    it('rejects an expired token', async () => {
      const jwt = app.get(JwtService);
      const expired = await jwt.signAsync({ sub: seed.admin.id, cid: seed.company.id, role: 'ADMIN', sv: 0 }, { expiresIn: 1 });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await as(expired).get('/auth/me').expect(401);
    });
  });

  describe('account lifecycle', () => {
    let employeeId: string;
    let email: string;
    let temporary: string;
    let password = 'Ledger-2026';

    it('creates an employee with login access in one step, INVITED with a one-time temporary password', async () => {
      email = `accounts-${stamp}@e2e.test`;
      const response = await as(tokens.ADMIN)
        .post('/employees', { fullName: 'Amit Pawar', role: 'ACCOUNTING', email, account: { role: 'ACCOUNTING', email } })
        .expect(201);
      employeeId = response.body.id;
      temporary = response.body.temporaryPassword;
      expect(temporary).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(response.body.account).toEqual({ role: 'ACCOUNTING', status: 'INVITED' });

      const row = await prisma.user.findFirstOrThrow({ where: { employeeId } });
      expect(row).toMatchObject({ status: 'INVITED', mustChangePassword: true, email });
      expect(row.passwordHash).not.toContain(temporary);

      const access = await as(tokens.ADMIN).get(`/employees/${employeeId}/account`).expect(200);
      expect(access.body.account).toMatchObject({ role: 'ACCOUNTING', status: 'INVITED', signInId: email, mustChangePassword: true });
      expect(JSON.stringify(access.body)).not.toMatch(/passwordHash|temporaryPassword/);

      // The temporary password is never in the audit trail.
      const audit = await prisma.auditLog.findMany({ where: { entityId: row.id } });
      expect(audit.map((a) => a.action)).toContain('account.created');
      expect(JSON.stringify(audit)).not.toContain(temporary);
    });

    it('only lets a temporary password reach /auth/me and change-password', async () => {
      const first = await login(email, temporary).expect(200);
      expect(first.body.user).toMatchObject({ status: 'INVITED', mustChangePassword: true });
      const token = first.body.accessToken as string;

      const blocked = await as(token).get('/employees').expect(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await as(token).get('/auth/me').expect(200);

      await as(token).post('/auth/change-password', { currentPassword: 'wrong-one-123', newPassword: password }).expect(400);
      const weak = await as(token).post('/auth/change-password', { currentPassword: temporary, newPassword: 'short' }).expect(400);
      expect(weak.body.error.details[0].field).toBe('newPassword');

      const changed = await as(token).post('/auth/change-password', { currentPassword: temporary, newPassword: password }).expect(200);
      expect(changed.body.user).toMatchObject({ status: 'ACTIVE', mustChangePassword: false });
      // The old token ended with the change; the new one works.
      await as(token).get('/auth/me').expect(401);
      await as(changed.body.accessToken).get('/employees').expect(200);
      await login(email, temporary).expect(401);
      await login(email, password).expect(200);
    });

    it('refuses a sign-in ID already in use, in this company or another, and writes nothing', async () => {
      const before = await prisma.employee.count({ where: { companyId: seed.company.id } });
      const same = await as(tokens.ADMIN).post('/employees', { fullName: 'Dup', role: 'MANAGER', account: { role: 'MANAGER', email } }).expect(409);
      expect(same.body.error.details[0].field).toBe('email');
      expect(await prisma.employee.count({ where: { companyId: seed.company.id } })).toBe(before);

      const otherAdmin = await tokenFor(other.admin.identifier);
      await as(otherAdmin).post('/employees', { fullName: 'Dup', role: 'MANAGER', account: { role: 'MANAGER', email } }).expect(409);
      const mobile = uniqueMobile();
      await as(tokens.ADMIN).post('/employees', { fullName: 'Phone Login', role: 'MANAGER', account: { role: 'MANAGER', phone: mobile } }).expect(201);
      // Written differently, still the same number.
      await as(otherAdmin).post('/employees', { fullName: 'Dup', role: 'MANAGER', account: { role: 'MANAGER', phone: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}` } }).expect(409);
      await as(tokens.ADMIN).post(`/employees/${employeeId}/account`, { role: 'MANAGER', email: `x-${stamp}@e2e.test` }).expect(409);
    });

    it('suspends: sign-in refused with a clear reason, existing sessions end', async () => {
      const token = await tokenFor(email, password);
      await as(tokens.ADMIN).post(`/employees/${employeeId}/account/suspend`, {}).expect(400);
      const suspended = await as(tokens.ADMIN).post(`/employees/${employeeId}/account/suspend`, { reason: 'Audit in progress' }).expect(200);
      expect(suspended.body.status).toBe('SUSPENDED');

      await as(token).get('/auth/me').expect(401);
      const refused = await login(email, password).expect(403);
      expect(refused.body.error.code).toBe('ACCOUNT_SUSPENDED');
      // A wrong password still gets the generic answer — status is revealed only to the owner.
      await login(email, 'not-the-password').expect(401);

      const back = await as(tokens.ADMIN).post(`/employees/${employeeId}/account/activate`).expect(200);
      expect(back.body.status).toBe('ACTIVE');
      await login(email, password).expect(200);
    });

    it('disables and reactivates without touching the employee record', async () => {
      await as(tokens.ADMIN).post(`/employees/${employeeId}/account/disable`, { reason: 'Left for another job' }).expect(200);
      expect((await login(email, password).expect(403)).body.error.code).toBe('ACCOUNT_DISABLED');
      expect((await as(tokens.ADMIN).get(`/employees/${employeeId}`).expect(200)).body.status).toBe('ACTIVE');
      await as(tokens.ADMIN).post(`/employees/${employeeId}/account/activate`).expect(200);
    });

    it('changes the role: old sessions end and the next sign-in carries the new role', async () => {
      const token = await tokenFor(email, password);
      await as(token).get('/finance/salaries').expect(200);
      await as(tokens.ADMIN).patch(`/employees/${employeeId}/account/role`, { role: 'ACCOUNTING' }).expect(400);
      const changed = await as(tokens.ADMIN).patch(`/employees/${employeeId}/account/role`, { role: 'MANAGER' }).expect(200);
      expect(changed.body.role).toBe('MANAGER');

      await as(token).get('/auth/me').expect(401);
      const next = await login(email, password).expect(200);
      expect(next.body.user.role).toBe('MANAGER');
      await as(next.body.accessToken).get('/finance/salaries').expect(403);
    });

    it('resets the password: old password and sessions stop working, a new change is required', async () => {
      const token = await tokenFor(email, password);
      const reset = await as(tokens.ADMIN).post(`/employees/${employeeId}/account/reset-password`).expect(200);
      const fresh = reset.body.temporaryPassword as string;
      expect(fresh).not.toBe(temporary);
      expect(reset.body.account.mustChangePassword).toBe(true);

      await as(token).get('/auth/me').expect(401);
      await login(email, password).expect(401);
      const again = await login(email, fresh).expect(200);
      expect(again.body.user.mustChangePassword).toBe(true);
      password = 'Fleet-Ops-77';
      await as(again.body.accessToken).post('/auth/change-password', { currentPassword: fresh, newPassword: password }).expect(200);
    });

    it('records every account change in the audit trail with who did it', async () => {
      const user = await prisma.user.findFirstOrThrow({ where: { employeeId } });
      const audit = await prisma.auditLog.findMany({ where: { entityId: user.id }, orderBy: { occurredAt: 'asc' } });
      const actions = audit.map((a) => a.action);
      for (const action of ['account.created', 'account.password_changed', 'account.suspended', 'account.activated', 'account.disabled', 'account.role_changed', 'account.password_reset']) {
        expect(actions).toContain(action);
      }
      expect(audit.find((a) => a.action === 'account.suspended')).toMatchObject({ actorUserId: seed.admin.id, actorRole: 'ADMIN', metadata: { reason: 'Audit in progress' } });
    });
  });

  describe('drivers', () => {
    it('creates a driver profile with a driver login in one step; the phone signs in to the driver role', async () => {
      const mobile = uniqueMobile();
      const employee = await as(tokens.ADMIN).post('/employees', { fullName: 'Ganesh Jadhav', role: 'DRIVER', phone: mobile }).expect(201);
      expect(employee.body.account).toBeNull();
      const driver = await as(tokens.ADMIN).post('/drivers', { employeeId: employee.body.id, account: { phone: `+91 ${mobile}` } }).expect(201);
      const temporary = driver.body.temporaryPassword as string;
      expect(temporary).toBeTruthy();

      // Typed as a driver would: no country code, with a space.
      const first = await login(`${mobile.slice(0, 5)} ${mobile.slice(5)}`, temporary).expect(200);
      expect(first.body.user).toMatchObject({ role: 'DRIVER', mustChangePassword: true, driverId: driver.body.id });
    });

    it('refuses a driver login for someone without a driver profile', async () => {
      const staff = await as(tokens.ADMIN).post('/employees', { fullName: 'Office Clerk', role: 'OTHER' }).expect(201);
      const refused = await as(tokens.ADMIN).post(`/employees/${staff.body.id}/account`, { role: 'DRIVER', phone: uniqueMobile() }).expect(400);
      expect(refused.body.error.message).toMatch(/driver profile/);
      const access = await as(tokens.ADMIN).get(`/employees/${staff.body.id}/account`).expect(200);
      expect(access.body).toMatchObject({ account: null, canManage: true });
      expect(access.body.assignableRoles).not.toContain('DRIVER');
    });
  });

  describe('who may manage whom', () => {
    it('keeps admins to operational roles; super admins may grant admin', async () => {
      const staff = await as(tokens.ADMIN).post('/employees', { fullName: 'Would-be Admin', role: 'ADMIN' }).expect(201);
      await as(tokens.ADMIN).post(`/employees/${staff.body.id}/account`, { role: 'ADMIN', email: `adm-${stamp}@e2e.test` }).expect(403);
      await as(tokens.ADMIN).post(`/employees/${staff.body.id}/account`, { role: 'SUPER_ADMIN', email: `adm-${stamp}@e2e.test` }).expect(403);
      await as(tokens.SUPER_ADMIN).post(`/employees/${staff.body.id}/account`, { role: 'ADMIN', email: `adm-${stamp}@e2e.test` }).expect(201);

      // An admin cannot touch another admin's account — even to look at its options.
      const access = await as(tokens.ADMIN).get(`/employees/${staff.body.id}/account`).expect(200);
      expect(access.body.canManage).toBe(false);
      await as(tokens.ADMIN).post(`/employees/${staff.body.id}/account/suspend`, { reason: 'x' }).expect(403);
      await as(tokens.ADMIN).post(`/employees/${staff.body.id}/account/reset-password`).expect(403);
    });

    it('never lets anyone change their own account', async () => {
      const me = await person('SUPER_ADMIN');
      const token = await tokenFor(me.email);
      await as(token).patch(`/employees/${me.employee.id}/account/role`, { role: 'MANAGER' }).expect(403);
      await as(token).post(`/employees/${me.employee.id}/account/disable`, { reason: 'oops' }).expect(403);
    });

    it.each(['MANAGER', 'ACCOUNTING', 'DRIVER'])('gives %s no account administration', async (role) => {
      await as(tokens[role]).get(`/employees/${seed.driver.employeeId}/account`).expect(403);
      await as(tokens[role]).post(`/employees/${seed.otherDriver.employeeId}/account`, { role: 'DRIVER', phone: uniqueMobile() }).expect(403);
    });

    it('refuses login access at creation from a manager, and creates nothing', async () => {
      const before = await prisma.employee.count({ where: { companyId: seed.company.id } });
      await as(tokens.MANAGER).post('/employees', { fullName: 'Sneaky', role: 'OTHER', account: { role: 'DRIVER', phone: uniqueMobile() } }).expect(403);
      expect(await prisma.employee.count({ where: { companyId: seed.company.id } })).toBe(before);
    });
  });

  describe('employment status', () => {
    it('disables the login when an employee exits, and does not reopen it on return', async () => {
      const email = `exit-${stamp}@e2e.test`;
      const created = await as(tokens.ADMIN).post('/employees', { fullName: 'Short Stay', role: 'MANAGER', account: { role: 'MANAGER', email } }).expect(201);
      const exited = await as(tokens.ADMIN).patch(`/employees/${created.body.id}/status`, { status: 'EXITED', reason: 'Resigned' }).expect(200);
      expect(exited.body.account).toEqual({ role: 'MANAGER', status: 'DISABLED' });
      expect((await login(email, created.body.temporaryPassword).expect(403)).body.error.code).toBe('ACCOUNT_DISABLED');

      await as(tokens.ADMIN).patch(`/employees/${created.body.id}/status`, { status: 'ACTIVE' }).expect(200);
      expect((await as(tokens.ADMIN).get(`/employees/${created.body.id}/account`)).body.account.status).toBe('DISABLED');
      const user = await prisma.user.findFirstOrThrow({ where: { employeeId: created.body.id } });
      const disabled = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: 'account.disabled' } });
      expect(disabled.metadata).toMatchObject({ reason: 'employment_status', employmentStatus: 'EXITED' });
    });

    it('lets a manager stand down a driver, but not an office login', async () => {
      const driverEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: seed.driver.employeeId } });
      const accountant = await person('ACCOUNTING');
      await as(tokens.MANAGER).patch(`/employees/${accountant.employee.id}/status`, { status: 'SUSPENDED' }).expect(403);

      await as(tokens.MANAGER).patch(`/employees/${driverEmployee.id}/status`, { status: 'SUSPENDED' }).expect(200);
      expect((await login(seed.driver.identifier).expect(403)).body.error.code).toBe('ACCOUNT_SUSPENDED');
      // Restore for the rest of the suite.
      await as(tokens.ADMIN).patch(`/employees/${driverEmployee.id}/status`, { status: 'ACTIVE' }).expect(200);
      await as(tokens.ADMIN).post(`/employees/${driverEmployee.id}/account/activate`).expect(200);
      tokens.DRIVER = await tokenFor(seed.driver.identifier);
    });
  });

  describe('tenancy', () => {
    it('never reaches another company’s employees or accounts', async () => {
      const otherAdmin = await tokenFor(other.admin.identifier);
      await as(otherAdmin).get(`/employees/${seed.driver.employeeId}/account`).expect(404);
      await as(otherAdmin).post(`/employees/${seed.otherDriver.employeeId}/account`, { role: 'MANAGER', email: `t-${stamp}@e2e.test` }).expect(404);
      await as(otherAdmin).post(`/employees/${seed.driver.employeeId}/account/suspend`, { reason: 'x' }).expect(404);
    });

    it('rejects a login linked to another company’s employee at the database', async () => {
      await expect(
        prisma.user.create({ data: { companyId: other.company.id, employeeId: seed.otherDriver.employeeId, email: `db-${stamp}@e2e.test`, role: 'DRIVER', passwordHash } }),
      ).rejects.toThrow(/another company/);
    });
  });

  describe('role × endpoint matrix', () => {
    type Row = [string, (token: string) => request.Test, Record<string, number>];
    const all = (s: number, overrides: Record<string, number> = {}) => ({ SUPER_ADMIN: s, ADMIN: s, MANAGER: s, ACCOUNTING: s, DRIVER: s, ...overrides });
    const rows: Row[] = [
      ['list employees', (t) => as(t).get('/employees'), all(200, { DRIVER: 403 })],
      ['list vehicles', (t) => as(t).get('/vehicles'), all(200, { DRIVER: 403 })],
      ['fuel statement', (t) => as(t).get('/fuel'), all(200, { DRIVER: 403 })],
      ['salaries', (t) => as(t).get('/finance/salaries'), all(200, { MANAGER: 403, DRIVER: 403 })],
      ['payments', (t) => as(t).get('/payments'), all(200, { MANAGER: 403, DRIVER: 403 })],
      ['edit a vehicle', (t) => as(t).patch(`/vehicles/${seed.vehicle.id}`, { notes: 'Checked' }), all(200, { ACCOUNTING: 403, DRIVER: 403 })],
      ['account access', (t) => as(t).get(`/employees/${seed.otherDriver.employeeId}/account`), all(200, { MANAGER: 403, ACCOUNTING: 403, DRIVER: 403 })],
      ['another driver', (t) => as(t).get(`/drivers/${seed.otherDriver.id}`), all(200, { DRIVER: 403 })],
      ['own driver profile', (t) => as(t).get('/drivers/me'), all(403, { DRIVER: 200 })],
      ['own payments', (t) => as(t).get('/payments/mine'), all(403, { DRIVER: 200 })],
    ];

    it.each(rows)('%s', async (_name, call, expected) => {
      for (const [role, status] of Object.entries(expected)) {
        const response = await call(tokens[role]);
        expect({ role, status: response.status }).toEqual({ role, status });
      }
    });
  });
});
