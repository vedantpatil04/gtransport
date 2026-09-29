import { canOpen, isOfficeRole, modulesFor, moreFor, officePath, sectionsFor, seesPayroll, tabsFor } from '../modules';

describe('office modules by role', () => {
  it('gives a driver no office modules at all', () => {
    expect(isOfficeRole('DRIVER')).toBe(false);
    expect(modulesFor('DRIVER')).toEqual([]);
    expect(tabsFor('DRIVER')).toEqual([]);
    expect(canOpen('DRIVER', 'dashboard')).toBe(false);
    expect(modulesFor(null)).toEqual([]);
    expect(sectionsFor('DRIVER')).toEqual([]);
    expect(sectionsFor(null)).toEqual([]);
  });

  it('gives admins the full office set', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      expect(modulesFor(role)).toEqual([
        'dashboard',
        'vehicles',
        'fuel',
        'finance',
        'fleet',
        'employees',
        'documents',
        'reports',
        'inbox',
        'settings',
        'profile',
      ]);
    }
  });

  it('gives a manager operations, reports and inbox without finance or settings', () => {
    expect(modulesFor('MANAGER')).not.toContain('finance');
    expect(modulesFor('MANAGER')).not.toContain('settings');
    expect(canOpen('MANAGER', 'finance')).toBe(false);
    expect(canOpen('MANAGER', 'settings')).toBe(false);
    expect(canOpen('MANAGER', 'fleet')).toBe(true);
    expect(canOpen('MANAGER', 'reports')).toBe(true);
    expect(canOpen('MANAGER', 'inbox')).toBe(true);
    expect(tabsFor('MANAGER')).toEqual(['dashboard', 'vehicles', 'fuel', 'documents']);
  });

  it('puts finance first for accounting and excludes settings', () => {
    expect(tabsFor('ACCOUNTING')).toEqual(['dashboard', 'finance', 'fuel', 'vehicles']);
    expect(canOpen('ACCOUNTING', 'finance')).toBe(true);
    expect(canOpen('ACCOUNTING', 'fleet')).toBe(true);
    expect(canOpen('ACCOUNTING', 'settings')).toBe(false);
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'] as const)('fits %s on four tabs, with the rest and Profile under More', (role) => {
    const tabs = tabsFor(role);
    expect(tabs.length).toBeLessThanOrEqual(4);
    expect(tabs).not.toContain('profile');
    expect(moreFor(role)).toContain('profile');
    expect([...tabs, ...moreFor(role)].sort()).toEqual([...modulesFor(role)].sort());
  });

  it('organizes More into Operations, Management, and System sections for admins', () => {
    expect(sectionsFor('ADMIN')).toEqual([
      { key: 'operations', modules: ['fleet', 'employees', 'documents'] },
      { key: 'management', modules: ['reports', 'inbox'] },
      { key: 'system', modules: ['settings', 'profile'] },
    ]);
  });

  it('respects role restrictions in sections', () => {
    expect(sectionsFor('MANAGER')).toEqual([
      { key: 'operations', modules: ['fleet', 'employees'] },
      { key: 'management', modules: ['reports', 'inbox'] },
      { key: 'system', modules: ['profile'] },
    ]);
    expect(sectionsFor('ACCOUNTING')).toEqual([
      { key: 'operations', modules: ['fleet', 'employees', 'documents'] },
      { key: 'management', modules: ['reports', 'inbox'] },
      { key: 'system', modules: ['profile'] },
    ]);
  });

  it('shows payroll figures only to the roles the API lets see them', () => {
    expect(seesPayroll('SUPER_ADMIN')).toBe(true);
    expect(seesPayroll('ADMIN')).toBe(true);
    expect(seesPayroll('ACCOUNTING')).toBe(true);
    expect(seesPayroll('MANAGER')).toBe(false);
    expect(seesPayroll('DRIVER')).toBe(false);
  });

  it('maps modules to correct /office or /admin paths', () => {
    expect(officePath('dashboard')).toBe('/office');
    expect(officePath('finance')).toBe('/office/finance');
    expect(officePath('vehicles')).toBe('/office/vehicles');
    expect(officePath('fuel')).toBe('/office/fuel');
    expect(officePath('employees')).toBe('/office/employees');
    expect(officePath('documents')).toBe('/office/documents');
    expect(officePath('profile')).toBe('/office/profile');
    expect(officePath('fleet')).toBe('/admin/fleet');
    expect(officePath('reports')).toBe('/admin/reports');
    expect(officePath('inbox')).toBe('/admin/inbox');
    expect(officePath('settings')).toBe('/admin/settings');
  });
});
