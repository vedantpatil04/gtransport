import { isNewerThanCurrent, validateFix } from './fix-validation';
import { distanceMetres, isValidCoordinate, roundCoordinate } from './geo';
import type { LocationIngestLimits } from './location.config';

const LIMITS: LocationIngestLimits = {
  maxAccuracyMeters: 2_000,
  maxClockSkewMinutes: 10,
  maxBacklogHours: 72,
  maxFixesPerMinute: 120,
};

const NOW = new Date('2026-03-04T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

const BELAGAVI = { latitude: 15.85, longitude: 74.498 };
const fix = (overrides: Partial<Parameters<typeof validateFix>[0]> = {}) => ({
  position: BELAGAVI,
  recordedAt: minutesAgo(1),
  accuracyMeters: 12,
  ...overrides,
});

describe('validateFix — coordinates', () => {
  it('accepts a normal fix', () => {
    expect(validateFix(fix(), LIMITS, NOW)).toEqual({ ok: true });
  });

  it('refuses a latitude off the planet', () => {
    const result = validateFix(fix({ position: { latitude: 99, longitude: 74 } }), LIMITS, NOW);
    expect(result).toMatchObject({ ok: false, reason: 'coordinates' });
  });

  it('refuses a longitude off the planet', () => {
    expect(validateFix(fix({ position: { latitude: 15, longitude: -200 } }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'coordinates' });
  });

  it('refuses the null-island reading a GPS chip gives with no fix', () => {
    // (0, 0) is in the Gulf of Guinea. It is what a cold chip reports, never where a truck is.
    expect(validateFix(fix({ position: { latitude: 0, longitude: 0 } }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'coordinates' });
  });

  it('refuses NaN, which arrives when a platform value is missing', () => {
    expect(validateFix(fix({ position: { latitude: Number.NaN, longitude: 74 } }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'coordinates' });
  });

  it('accepts a genuine position that happens to sit on a zero meridian', () => {
    expect(isValidCoordinate({ latitude: 15.85, longitude: 0 })).toBe(true);
    expect(isValidCoordinate({ latitude: 0, longitude: 74.498 })).toBe(true);
  });
});

describe('validateFix — accuracy', () => {
  it('refuses a fix far too imprecise to store', () => {
    expect(validateFix(fix({ accuracyMeters: 5_000 }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'accuracy' });
  });

  it('refuses a negative accuracy', () => {
    expect(validateFix(fix({ accuracyMeters: -1 }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'accuracy' });
  });

  it('accepts a fix that reports no accuracy at all', () => {
    expect(validateFix(fix({ accuracyMeters: null }), LIMITS, NOW)).toEqual({ ok: true });
  });

  it('accepts a poor but usable fix, which is still a position worth keeping', () => {
    expect(validateFix(fix({ accuracyMeters: 1_800 }), LIMITS, NOW)).toEqual({ ok: true });
  });
});

describe('validateFix — timestamps', () => {
  it('refuses an unparseable timestamp', () => {
    expect(validateFix(fix({ recordedAt: new Date('not a date') }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'timestamp' });
  });

  it('refuses a fix from the future, so a wrong device clock cannot pin itself to the top', () => {
    const future = new Date(NOW.getTime() + 30 * 60_000);
    expect(validateFix(fix({ recordedAt: future }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'future' });
  });

  it('tolerates a small clock difference, which every phone has', () => {
    const slightlyAhead = new Date(NOW.getTime() + 60_000);
    expect(validateFix(fix({ recordedAt: slightlyAhead }), LIMITS, NOW)).toEqual({ ok: true });
  });

  it('accepts a fix buffered offline for two days', () => {
    // This is the whole point of the offline buffer: a driver out of signal must not lose fixes.
    expect(validateFix(fix({ recordedAt: hoursAgo(48) }), LIMITS, NOW)).toEqual({ ok: true });
  });

  it('refuses a fix older than the backlog window, which no longer describes anything useful', () => {
    expect(validateFix(fix({ recordedAt: hoursAgo(100) }), LIMITS, NOW)).toMatchObject({ ok: false, reason: 'too-old' });
  });
});

describe('isNewerThanCurrent', () => {
  it('accepts the first fix a driver ever sends', () => {
    expect(isNewerThanCurrent(minutesAgo(1), null)).toBe(true);
  });

  it('advances the current position for a newer fix', () => {
    expect(isNewerThanCurrent(minutesAgo(1), minutesAgo(5))).toBe(true);
  });

  it('refuses to move the marker backwards for a late-arriving older fix', () => {
    // The scenario: a buffered fix from an hour ago uploads after the live tracker's newest one.
    // History keeps it; the driver's dot on the map must not jump back to where they were.
    expect(isNewerThanCurrent(minutesAgo(60), minutesAgo(2))).toBe(false);
  });

  it('treats a re-sent identical timestamp as no new information', () => {
    const t = minutesAgo(3);
    expect(isNewerThanCurrent(t, new Date(t.getTime()))).toBe(false);
  });
});

describe('geo helpers', () => {
  it('measures a known distance', () => {
    // Belagavi to Hubballi is about 84 km by air.
    const hubballi = { latitude: 15.364, longitude: 75.124 };
    const km = distanceMetres(BELAGAVI, hubballi) / 1000;
    expect(km).toBeGreaterThan(80);
    expect(km).toBeLessThan(90);
  });

  it('measures zero between a point and itself', () => {
    expect(distanceMetres(BELAGAVI, BELAGAVI)).toBe(0);
  });

  it('measures a short distance the radius check depends on', () => {
    const hundredMetresNorth = { latitude: BELAGAVI.latitude + 100 / 111_320, longitude: BELAGAVI.longitude };
    expect(distanceMetres(BELAGAVI, hundredMetresNorth)).toBeCloseTo(100, 0);
  });

  it('stays correct across the antimeridian, where subtracting longitudes does not', () => {
    const west = { latitude: 0, longitude: 179.99 };
    const east = { latitude: 0, longitude: -179.99 };
    // Two kilometres apart, not most of the way round the world.
    expect(distanceMetres(west, east)).toBeLessThan(3_000);
  });

  it('rounds to the six decimal places the column stores', () => {
    expect(roundCoordinate(15.8500004999)).toBe(15.85);
    expect(roundCoordinate(74.4981239999)).toBe(74.498124);
  });
});
