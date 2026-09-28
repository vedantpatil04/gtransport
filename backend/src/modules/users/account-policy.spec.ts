import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { assertCanManageAccount, canAdministerAccounts, canStandDownLogin, manageableRoles } from './account-policy';
import { generateTemporaryPassword, normaliseEmail, normaliseMobile, passwordProblem } from './credentials';

const { SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTING, DRIVER } = UserRole;
const ALL = [SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTING, DRIVER];

describe('account administration policy', () => {
  it('lets only super admins and admins administer accounts', () => {
    expect(ALL.filter(canAdministerAccounts)).toEqual([SUPER_ADMIN, ADMIN]);
  });

  it('limits admins to operational roles', () => {
    expect(manageableRoles(SUPER_ADMIN)).toEqual(ALL);
    expect(manageableRoles(ADMIN)).toEqual([MANAGER, ACCOUNTING, DRIVER]);
    for (const role of [MANAGER, ACCOUNTING, DRIVER]) expect(manageableRoles(role)).toEqual([]);
  });

  it.each([
    [SUPER_ADMIN, ADMIN, SUPER_ADMIN, true],
    [SUPER_ADMIN, DRIVER, ADMIN, true],
    [ADMIN, DRIVER, ACCOUNTING, true],
    [ADMIN, MANAGER, DRIVER, true],
    [ADMIN, DRIVER, ADMIN, false], // may not promote to admin
    [ADMIN, ADMIN, MANAGER, false], // may not touch another admin
    [ADMIN, SUPER_ADMIN, undefined, false],
    [MANAGER, DRIVER, undefined, false],
    [ACCOUNTING, DRIVER, undefined, false],
    [DRIVER, DRIVER, undefined, false],
  ] as const)('%s acting on a %s account (→ %s): allowed=%s', (actor, target, next, allowed) => {
    const run = () => assertCanManageAccount({ id: 'actor', role: actor }, { id: 'target', role: target }, next);
    if (allowed) expect(run).not.toThrow();
    else expect(run).toThrow(ForbiddenException);
  });

  it('checks the role being granted when creating an account', () => {
    expect(() => assertCanManageAccount({ id: 'a', role: ADMIN }, null, DRIVER)).not.toThrow();
    expect(() => assertCanManageAccount({ id: 'a', role: ADMIN }, null, ADMIN)).toThrow(ForbiddenException);
    expect(() => assertCanManageAccount({ id: 'a', role: MANAGER }, null, DRIVER)).toThrow(ForbiddenException);
  });

  it('never lets anyone change their own account', () => {
    expect(() => assertCanManageAccount({ id: 'same', role: SUPER_ADMIN }, { id: 'same', role: SUPER_ADMIN })).toThrow(/your own account/);
  });

  it('lets managers stand down drivers only', () => {
    expect(canStandDownLogin(MANAGER, DRIVER)).toBe(true);
    expect(canStandDownLogin(MANAGER, ACCOUNTING)).toBe(false);
    expect(canStandDownLogin(ADMIN, MANAGER)).toBe(true);
    expect(canStandDownLogin(ADMIN, ADMIN)).toBe(false);
    expect(canStandDownLogin(ACCOUNTING, DRIVER)).toBe(false);
  });
});

describe('credentials', () => {
  it('generates readable temporary passwords with a letter and a digit', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const pw = generateTemporaryPassword();
      expect(pw).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}-[A-HJ-NP-Za-km-np-z2-9]{4}$/);
      expect(pw).toMatch(/\d/);
      expect(pw).toMatch(/[A-Za-z]/);
      seen.add(pw);
    }
    expect(seen.size).toBeGreaterThan(495);
  });

  it('refuses weak or reused passwords', () => {
    expect(passwordProblem('short', {})).toMatch(/at least 8/);
    expect(passwordProblem('Kp7m-X3qa', { current: 'Kp7m-X3qa' })).toMatch(/different/);
    expect(passwordProblem('11111111', {})).toMatch(/repeat/);
    expect(passwordProblem('9845012345', { identifiers: ['+919845012345'] })).toMatch(/mobile number or email/);
    expect(passwordProblem('ramesh@gangamata.in', { identifiers: ['ramesh@gangamata.in'] })).toMatch(/mobile number or email/);
    expect(passwordProblem('trucks-2026', { current: 'Kp7m-X3qa', identifiers: ['+919845012345'] })).toBeNull();
  });

  it('normalises Indian mobile numbers to E.164', () => {
    for (const input of ['9845012345', '98450 12345', '+91 98450-12345', '919845012345', '09845012345']) {
      expect(normaliseMobile(input)).toBe('+919845012345');
    }
    for (const input of ['12345', '5845012345', '+1 415 555 0100', 'abc']) expect(normaliseMobile(input)).toBeNull();
  });

  it('normalises email addresses', () => {
    expect(normaliseEmail('  Ramesh@Gangamata.IN ')).toBe('ramesh@gangamata.in');
    expect(normaliseEmail('not-an-email')).toBeNull();
  });
});
