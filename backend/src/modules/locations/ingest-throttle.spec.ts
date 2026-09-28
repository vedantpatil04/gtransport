import { LocationIngestThrottle } from './ingest-throttle';

/**
 * The limit exists to stop one faulty device, not to interfere with normal tracking. The tests
 * below pin both halves of that: a whole day of correct reporting passes, and a retry loop is cut
 * off — per driver, never per network, because a depot full of drivers shares one carrier IP.
 */

const LIMIT = 120;
const T0 = 1_772_000_000_000;

describe('LocationIngestThrottle', () => {
  let throttle: LocationIngestThrottle;

  beforeEach(() => {
    throttle = new LocationIngestThrottle();
  });

  it('allows a normal batch', () => {
    expect(throttle.check('driver-1', 5, LIMIT, T0)).toMatchObject({ allowed: true });
  });

  it('adds up several batches inside the same minute', () => {
    throttle.check('driver-1', 60, LIMIT, T0);
    const second = throttle.check('driver-1', 50, LIMIT, T0 + 10_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(10);
  });

  it('refuses the batch that would cross the ceiling', () => {
    throttle.check('driver-1', LIMIT, LIMIT, T0);
    const refused = throttle.check('driver-1', 1, LIMIT, T0 + 30_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('refuses a batch whole rather than partly, so the same batch can be retried unchanged', () => {
    throttle.check('driver-1', 100, LIMIT, T0);
    const refused = throttle.check('driver-1', 50, LIMIT, T0 + 1_000);
    expect(refused.allowed).toBe(false);
    // Nothing was consumed, so the remaining allowance still reflects only the first batch.
    expect(refused.remaining).toBe(20);
  });

  it('opens a fresh allowance in the next minute', () => {
    throttle.check('driver-1', LIMIT, LIMIT, T0);
    expect(throttle.check('driver-1', LIMIT, LIMIT, T0 + 60_001)).toMatchObject({ allowed: true });
  });

  it('counts each driver separately, so one bad phone cannot throttle a depot', () => {
    throttle.check('driver-1', LIMIT, LIMIT, T0);
    expect(throttle.check('driver-1', 1, LIMIT, T0).allowed).toBe(false);
    expect(throttle.check('driver-2', 1, LIMIT, T0).allowed).toBe(true);
    expect(throttle.check('driver-3', 100, LIMIT, T0).allowed).toBe(true);
  });

  it('refuses a single batch larger than the whole minute allowance', () => {
    expect(throttle.check('driver-1', LIMIT + 1, LIMIT, T0).allowed).toBe(false);
  });

  it('lets a full day of correct reporting through untouched', () => {
    // One fix a minute for 24 hours — the configured moving interval — must never be throttled.
    let refused = 0;
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      if (!throttle.check('driver-1', 1, LIMIT, T0 + minute * 60_000).allowed) refused += 1;
    }
    expect(refused).toBe(0);
  });

  it('cuts off a device stuck in a retry loop', () => {
    let refusedAt = -1;
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      if (!throttle.check('driver-1', 1, LIMIT, T0 + attempt * 100).allowed) {
        refusedAt = attempt;
        break;
      }
    }
    expect(refusedAt).toBe(LIMIT + 1);
  });

  it('forgets drivers that have gone quiet, so memory cannot grow without bound', () => {
    throttle.check('driver-1', 10, LIMIT, T0);
    // Well past the sweep window: the old window is discarded and the allowance is fresh.
    expect(throttle.check('driver-2', 10, LIMIT, T0 + 30 * 60_000).allowed).toBe(true);
    expect(throttle.check('driver-1', LIMIT, LIMIT, T0 + 30 * 60_000).allowed).toBe(true);
  });

  it('starts over after a reset', () => {
    throttle.check('driver-1', LIMIT, LIMIT, T0);
    throttle.reset();
    expect(throttle.check('driver-1', LIMIT, LIMIT, T0).allowed).toBe(true);
  });
});
