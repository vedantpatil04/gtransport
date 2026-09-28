import {
  EMPTY_STATIONARY_STATE, durationMinutes, evaluateStationary, NO_KNOWN_LOCATIONS,
  type KnownLocationResolver, type StationaryState,
} from './stationary-engine';
import { distanceMetres } from './geo';
import type { StationaryPolicy } from './location.config';

/**
 * The stationary rule is the heart of Phase 6, and the expensive failures are not the obvious
 * ones — they are "a parked truck never alerted because GPS jitter kept resetting the timer" and
 * "every fix after the fourth hour raised another alert". Both are covered below.
 */

const POLICY: StationaryPolicy = {
  radiusMeters: 150,
  minDurationMs: 4 * 60 * 60 * 1000,
  maxAccuracyMeters: 200,
};

/** A depot in Belagavi, where Gangamata actually operates. */
const DEPOT = { latitude: 15.85, longitude: 74.498 };
const START = new Date('2026-03-04T06:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

/** Offsets a position by metres. ~111,320 m per degree of latitude. */
const northOf = (from: { latitude: number; longitude: number }, metres: number) => ({
  latitude: from.latitude + metres / 111_320,
  longitude: from.longitude,
});

const fix = (position: { latitude: number; longitude: number }, minutes: number, accuracyMeters: number | null = 10) => ({
  position,
  recordedAt: at(minutes),
  accuracyMeters,
});

describe('evaluateStationary — starting a period', () => {
  it('anchors on the first fix, because nothing is known about the time before it', () => {
    const outcome = evaluateStationary(EMPTY_STATIONARY_STATE, fix(DEPOT, 0), POLICY);

    expect(outcome.kind).toBe('started');
    expect(outcome.state.anchor).toEqual(DEPOT);
    expect(outcome.state.since).toEqual(at(0));
    expect(outcome.state.alertId).toBeNull();
  });

  it('starts a new period when the driver leaves the radius', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };
    const moved = northOf(DEPOT, 400);

    const outcome = evaluateStationary(state, fix(moved, 30), POLICY);

    expect(outcome.kind).toBe('started');
    expect(outcome.state.anchor).toEqual(moved);
    expect(outcome.state.since).toEqual(at(30));
    if (outcome.kind === 'started') expect(outcome.movedFrom).toEqual(DEPOT);
  });
});

describe('evaluateStationary — holding position', () => {
  it('keeps the original anchor while the driver stays inside the radius', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };

    const outcome = evaluateStationary(state, fix(northOf(DEPOT, 80), 60), POLICY);

    expect(outcome.kind).toBe('holding');
    // The anchor must not follow the driver: an anchor that crept along would let a slow drift
    // accumulate past the radius unnoticed, and would restart the clock on every fix.
    expect(outcome.state.anchor).toEqual(DEPOT);
    expect(outcome.state.since).toEqual(at(0));
    if (outcome.kind === 'holding') expect(outcome.heldForMs).toBe(60 * 60_000);
  });

  it('is not reset by GPS jitter around a stationary phone', () => {
    // A phone lying on a dashboard reports a position that wanders by tens of metres. Comparing
    // each fix with the previous one, this sequence reads as constant movement.
    let state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };
    const jitter = [12, -25, 40, -18, 33, -9, 27, -35];

    jitter.forEach((metres, index) => {
      const outcome = evaluateStationary(state, fix(northOf(DEPOT, metres), (index + 1) * 20), POLICY);
      expect(outcome.kind).toBe('holding');
      state = outcome.state;
    });

    // Three hours of jitter later the clock is still running from the original fix.
    expect(state.since).toEqual(at(0));
    expect(state.anchor).toEqual(DEPOT);
  });

  it('detects a slow creep out of the region rather than calling it stationary for ever', () => {
    // 40 m per fix is inside the radius at every single step, but adds up to half a kilometre.
    let state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };
    let lastKind = '';

    for (let step = 1; step <= 12; step += 1) {
      const outcome = evaluateStationary(state, fix(northOf(DEPOT, step * 40), step * 10), POLICY);
      lastKind = outcome.kind;
      state = outcome.state;
    }

    // Measured against a fixed anchor, the creep crosses the radius and is seen as movement.
    expect(lastKind).toBe('started');
    expect(distanceMetres(DEPOT, state.anchor!)).toBeGreaterThan(POLICY.radiusMeters);
  });
});

describe('evaluateStationary — reaching the threshold', () => {
  it('reports the threshold once four hours have passed inside the radius', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };

    const outcome = evaluateStationary(state, fix(northOf(DEPOT, 60), 240), POLICY);

    expect(outcome.kind).toBe('threshold-reached');
    if (outcome.kind === 'threshold-reached') {
      expect(outcome.since).toEqual(at(0));
      expect(durationMinutes(outcome.heldForMs)).toBe(240);
      expect(outcome.suppressedBy).toBeNull();
    }
  });

  it('does not report the threshold a minute early', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };
    expect(evaluateStationary(state, fix(DEPOT, 239), POLICY).kind).toBe('holding');
  });

  it('raises nothing further once the period has already alerted', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: 'alert-1' };

    // Every subsequent fix in the same stop — one every fifteen minutes for another two hours.
    for (const minutes of [245, 260, 275, 290, 320, 360]) {
      const outcome = evaluateStationary(state, fix(DEPOT, minutes), POLICY);
      expect(outcome.kind).toBe('already-alerted');
      expect(outcome.state.alertId).toBe('alert-1');
    }
  });

  it('lets a new stop after real movement raise its own alert', () => {
    const alerted: StationaryState = { anchor: DEPOT, since: at(0), alertId: 'alert-1' };

    const moved = evaluateStationary(alerted, fix(northOf(DEPOT, 900), 300), POLICY);
    expect(moved.kind).toBe('started');
    // The reference is dropped, so the next four-hour stop is not silenced by the previous alert.
    expect(moved.state.alertId).toBeNull();
    if (moved.kind === 'started') expect(moved.clearedAlertId).toBe('alert-1');

    const parkedAgain = evaluateStationary(moved.state, fix(northOf(DEPOT, 900), 540), POLICY);
    expect(parkedAgain.kind).toBe('threshold-reached');
  });
});

describe('evaluateStationary — imprecise and out-of-order fixes', () => {
  it('ignores a fix too imprecise to compare against the radius', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };

    // A 900 m error radius says nothing about a 150 m question: acting on it would either
    // invent movement or hide it.
    const outcome = evaluateStationary(state, fix(northOf(DEPOT, 800), 120, 900), POLICY);

    expect(outcome.kind).toBe('ignored');
    expect(outcome.state).toEqual(state);
  });

  it('accepts a fix with no reported accuracy at all', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };
    expect(evaluateStationary(state, fix(DEPOT, 120, null), POLICY).kind).toBe('holding');
  });

  it('does not let a late fix from before the period make a stop look longer', () => {
    // A buffered fix from an hour before the current period began, uploaded now.
    const state: StationaryState = { anchor: DEPOT, since: at(300), alertId: null };

    const outcome = evaluateStationary(state, fix(DEPOT, 240), POLICY);

    expect(outcome.kind).toBe('holding');
    if (outcome.kind === 'holding') expect(outcome.heldForMs).toBe(0);
    expect(outcome.state.since).toEqual(at(300));
  });
});

describe('evaluateStationary — known locations', () => {
  const depotResolver: KnownLocationResolver = {
    resolve: (position) => (distanceMetres(position, DEPOT) < 200 ? { id: 'depot', name: 'Belagavi depot' } : null),
  };

  it('suppresses the alert at a known place but keeps the clock running', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };

    const outcome = evaluateStationary(state, fix(DEPOT, 240), POLICY, depotResolver);

    expect(outcome.kind).toBe('threshold-reached');
    if (outcome.kind === 'threshold-reached') {
      expect(outcome.suppressedBy).toEqual({ id: 'depot', name: 'Belagavi depot' });
      // The office can still see how long the vehicle has been there.
      expect(outcome.since).toEqual(at(0));
    }
  });

  it('still alerts away from any known place', () => {
    const state = { anchor: northOf(DEPOT, 5_000), since: at(0), alertId: null };
    const outcome = evaluateStationary(state, fix(northOf(DEPOT, 5_000), 240), POLICY, depotResolver);

    expect(outcome.kind).toBe('threshold-reached');
    if (outcome.kind === 'threshold-reached') expect(outcome.suppressedBy).toBeNull();
  });

  it('suppresses nothing by default', () => {
    const state: StationaryState = { anchor: DEPOT, since: at(0), alertId: null };
    const outcome = evaluateStationary(state, fix(DEPOT, 240), POLICY, NO_KNOWN_LOCATIONS);
    if (outcome.kind === 'threshold-reached') expect(outcome.suppressedBy).toBeNull();
  });
});

describe('durationMinutes', () => {
  it('reports whole minutes', () => {
    expect(durationMinutes(4 * 60 * 60_000)).toBe(240);
    expect(durationMinutes(90_000)).toBe(1);
  });

  it('never reports zero, because an alert always describes some elapsed time', () => {
    expect(durationMinutes(0)).toBe(1);
    expect(durationMinutes(-5_000)).toBe(1);
  });
});
