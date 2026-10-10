import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareMigrations, readBundledMigrations, type AppliedMigration } from './migration-status.service';

const done = (name: string): AppliedMigration => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

describe('compareMigrations', () => {
  const shipped = ['20260922000000_init', '20261005000000_phase8_reporting_indexes', '20261008000000_admin_ledger_payments'];

  it('is current when every shipped migration has finished', () => {
    expect(compareMigrations(shipped, shipped.map(done))).toEqual({ status: 'current', pending: [], failed: [] });
  });

  it('is behind when a shipped migration was never applied — the situation behind the Finance "database error"', () => {
    const result = compareMigrations(shipped, shipped.slice(0, 2).map(done));
    expect(result).toEqual({ status: 'behind', pending: ['20261008000000_admin_ledger_payments'], failed: [] });
  });

  it('is behind when a migration started but never finished, and reports it as failed', () => {
    const applied = [done(shipped[0]!), done(shipped[1]!), { migration_name: shipped[2]!, finished_at: null, rolled_back_at: null }];
    expect(compareMigrations(shipped, applied)).toMatchObject({ status: 'behind', failed: [shipped[2]], pending: [shipped[2]] });
  });

  it('counts a rolled-back migration as not applied', () => {
    const applied = [...shipped.slice(0, 2).map(done), { migration_name: shipped[2]!, finished_at: new Date(), rolled_back_at: new Date() }];
    expect(compareMigrations(shipped, applied).status).toBe('behind');
  });

  it('ignores migrations the database has that this build does not ship (a rollback of the code)', () => {
    expect(compareMigrations(shipped.slice(0, 1), shipped.map(done)).status).toBe('current');
  });
});

describe('readBundledMigrations', () => {
  it('lists migration folders oldest first and skips migration_lock.toml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    mkdirSync(join(dir, '20261005000000_b'));
    mkdirSync(join(dir, '20260922000000_a'));
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
    expect(readBundledMigrations(dir)).toEqual(['20260922000000_a', '20261005000000_b']);
  });

  it('returns null when the folder is not there, so the check reports unknown instead of guessing', () => {
    expect(readBundledMigrations(join(tmpdir(), 'no-such-migrations-folder'))).toBeNull();
  });
});
