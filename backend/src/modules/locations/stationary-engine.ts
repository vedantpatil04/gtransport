import { distanceMetres, type Coordinates } from './geo';
import type { StationaryPolicy } from './location.config';

/**
 * Server-side stationary detection.
 *
 * The rule the office cares about: a driver who has not left a small area for four continuous
 * hours should be flagged. Everything below exists to make that judgement survive real GPS.
 *
 * ── Why an anchor, and not the previous point ──
 *
 * The obvious implementation compares each fix with the one before it and calls the driver
 * "still" when they are close. That fails twice over:
 *
 *   - A stationary phone reports a position that wanders by tens of metres. Comparing
 *     consecutive points, that jitter reads as movement and resets the timer, so a truck parked
 *     all day never raises an alert.
 *   - Conversely, a vehicle creeping forward a few metres per fix looks stationary at every
 *     single step, even after moving a kilometre.
 *
 * So the driver is measured against a fixed anchor: the position where the current stationary
 * period began. Jitter around that anchor changes nothing; genuine travel crosses the radius
 * and starts a new period. The anchor never follows the driver inside the radius, because an
 * anchor that crept along would reintroduce exactly the drift problem it exists to prevent.
 *
 * ── Why a poor fix is skipped ──
 *
 * A fix whose accuracy is wider than the radius says nothing useful about a 150 m question. It
 * is stored (it is still a rough position) but takes no part in this decision, because acting
 * on it would either invent movement or conceal it.
 *
 * ── Extension point ──
 *
 * `knownLocation` lets a later phase suppress alerts at the office, the workshop or a customer
 * yard without touching this file: a named place is returned, the alert is not raised, and the
 * timer keeps running so the office can still see how long the vehicle has been there.
 */

/** Persisted stationary state for one driver, as held on the current-location row. */
export interface StationaryState {
  anchor: Coordinates | null;
  since: Date | null;
  /** The alert already raised for the current period, if any. */
  alertId: string | null;
}

export interface StationaryInput {
  position: Coordinates;
  /** Device timestamp of the fix. Durations are measured on the device clock, consistently. */
  recordedAt: Date;
  /** Reported accuracy in metres, when the platform gives one. */
  accuracyMeters: number | null;
}

/** A named place where stopping is expected. Returning one suppresses the alert, not the timer. */
export interface KnownLocation {
  id: string;
  name: string;
}

/** Resolves whether a position sits inside a known place. Phase 6 ships the no-op. */
export interface KnownLocationResolver {
  resolve(position: Coordinates): KnownLocation | null;
}

/** No geofences are configured yet, so nothing is suppressed. */
export const NO_KNOWN_LOCATIONS: KnownLocationResolver = { resolve: () => null };

export type StationaryOutcome =
  /** The fix was too imprecise to judge: state untouched. */
  | { kind: 'ignored'; reason: 'accuracy'; state: StationaryState }
  /** A new stationary period began — first ever fix, or the driver genuinely moved. */
  | { kind: 'started'; state: StationaryState; movedFrom: Coordinates | null; clearedAlertId: string | null }
  /** Still inside the region, threshold not reached yet. */
  | { kind: 'holding'; state: StationaryState; heldForMs: number; distanceMeters: number }
  /** The threshold has just been crossed: an alert should be created. */
  | { kind: 'threshold-reached'; state: StationaryState; heldForMs: number; since: Date; suppressedBy: KnownLocation | null }
  /** Already alerted for this period; nothing further to raise. */
  | { kind: 'already-alerted'; state: StationaryState; heldForMs: number };

/**
 * Decides what a single fix means for the driver's stationary state.
 *
 * Pure: it returns the next state and what happened, and writes nothing. The caller persists
 * the state and creates the alert, which keeps the rule itself trivial to test exhaustively.
 */
export function evaluateStationary(
  state: StationaryState,
  input: StationaryInput,
  policy: StationaryPolicy,
  knownLocations: KnownLocationResolver = NO_KNOWN_LOCATIONS,
): StationaryOutcome {
  // Too vague to compare against the radius — keep the state exactly as it was.
  if (input.accuracyMeters !== null && input.accuracyMeters > policy.maxAccuracyMeters) {
    return { kind: 'ignored', reason: 'accuracy', state };
  }

  const begin = (movedFrom: Coordinates | null, clearedAlertId: string | null): StationaryOutcome => ({
    kind: 'started',
    state: { anchor: input.position, since: input.recordedAt, alertId: null },
    movedFrom,
    clearedAlertId,
  });

  // No anchor yet: this fix establishes one. Nothing is known about how long they were here
  // before we started watching, so the clock starts now rather than being guessed.
  if (!state.anchor || !state.since) return begin(null, state.alertId);

  const distance = distanceMetres(state.anchor, input.position);

  // Beyond the radius: real movement. The period ends, a new one begins here, and the alert
  // reference is dropped so a later stop raises its own alert.
  if (distance > policy.radiusMeters) return begin(state.anchor, state.alertId);

  // Inside the radius. The anchor and the start time are deliberately left untouched.
  const held = input.recordedAt.getTime() - state.since.getTime();

  // A fix whose device clock predates the start of the period cannot extend it. This happens
  // when a buffered fix arrives late; it is stored, but it must not make a stop look longer.
  if (held < 0) return { kind: 'holding', state, heldForMs: 0, distanceMeters: distance };

  if (state.alertId) return { kind: 'already-alerted', state, heldForMs: held };

  if (held >= policy.minDurationMs) {
    return {
      kind: 'threshold-reached',
      state,
      heldForMs: held,
      since: state.since,
      suppressedBy: knownLocations.resolve(state.anchor),
    };
  }

  return { kind: 'holding', state, heldForMs: held, distanceMeters: distance };
}

export const EMPTY_STATIONARY_STATE: StationaryState = { anchor: null, since: null, alertId: null };

/** Whole minutes a stop had lasted when it was flagged. Alerts record minutes, not milliseconds. */
export const durationMinutes = (ms: number): number => Math.max(1, Math.floor(ms / 60_000));
