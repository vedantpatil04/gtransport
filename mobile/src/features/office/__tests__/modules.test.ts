import { canOpen, isOfficeRole, modulesFor, moreFor, officePath, seesPayroll, tabsFor } from '../modules';

describe('office modules by role', () => {
  it('gives a driver no office modules at all', () => {
    expect(isOfficeRole('DRIVER')).toBe(false);
    expect(modulesFor('DRIVER')).toEqual([]);
    expect(tabsFor('DRIVER')).toEqual([]);
    expect(canOpen('DRIVER', 'dashboard')).toBe(false);
    expect(modulesFor(null)).toEqual([]);
  });

  it('gives admins the full office set', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      expect(modulesFor(role)).toEqual(['dashboard', 'vehicles', 'fuel', 'finance', 'employees', 'documents', 'profile']);
    }
  });

  it('gives a manager operations and no finance', () => {
    expect(modulesFor('MANAGER')).not.toContain('finance');
    expect(canOpen('MANAGER', 'finance')).toBe(false);
    expect(tabsFor('MANAGER')).toEqual(['dashboard', 'vehicles', 'fuel', 'documents']);
  });

  it('puts finance first for accounting', () => {
    expect(tabsFor('ACCOUNTING')).toEqual(['dashboard', 'finance', 'fuel', 'vehicles']);
    expect(canOpen('ACCOUNTING', 'finance')).toBe(true);
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'] as const)('fits %s on four tabs, with the rest and Profile under More', (role) => {
    const tabs = tabsFor(role);
    expect(tabs.length).toBeLessThanOrEqual(4);
    expect(tabs).not.toContain('profile');
    expect(moreFor(role)).toContain('profile');
    expect([...tabs, ...moreFor(role)].sort()).toEqual([...modulesFor(role)].sort());
  });

  it('shows payroll figures only to the roles the API lets see them', () => {
    expect(seesPayroll('SUPER_ADMIN')).toBe(true);
    expect(seesPayroll('ADMIN')).toBe(true);
    expect(seesPayroll('ACCOUNTING')).toBe(true);
    expect(seesPayroll('MANAGER')).toBe(false);
    expect(seesPayroll('DRIVER')).toBe(false);
  });

  it('maps modules to /office paths', () => {
    expect(officePath('dashboard')).toBe('/office');
    expect(officePath('finance')).toBe('/office/finance');
  });
});
