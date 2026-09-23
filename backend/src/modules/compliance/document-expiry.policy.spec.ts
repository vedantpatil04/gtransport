import { documentExpiryStatus } from './document-expiry.policy';

const TODAY = new Date('2026-03-04T08:30:00Z');
const inDays = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

describe('documentExpiryStatus', () => {
  it('returns "none" when a document has no expiry (e.g. RC)', () => {
    expect(documentExpiryStatus(null, TODAY)).toEqual({ state: 'none', level: 0, days: null });
  });

  it('escalates through the 30/15/7/3-day buckets used by the admin UI', () => {
    expect(documentExpiryStatus(inDays(25), TODAY)).toMatchObject({ state: 'expiring', level: 1 });
    expect(documentExpiryStatus(inDays(12), TODAY)).toMatchObject({ state: 'expiring', level: 2 });
    expect(documentExpiryStatus(inDays(5), TODAY)).toMatchObject({ state: 'expiring', level: 3 });
    expect(documentExpiryStatus(inDays(2), TODAY)).toMatchObject({ state: 'expiring', level: 4 });
  });

  it('treats a document expiring today as expiring, not expired', () => {
    expect(documentExpiryStatus(new Date('2026-03-04T00:00:00Z'), TODAY)).toMatchObject({ state: 'expiring', level: 4, days: 0 });
  });

  it('reports expired documents with negative days', () => {
    expect(documentExpiryStatus(new Date('2026-03-01T00:00:00Z'), TODAY)).toMatchObject({ state: 'expired', level: 5, days: -3 });
  });

  it('ignores time of day when counting days', () => {
    expect(documentExpiryStatus(new Date('2026-04-10T23:59:00Z'), TODAY)).toMatchObject({ state: 'valid', level: 0 });
  });
});
