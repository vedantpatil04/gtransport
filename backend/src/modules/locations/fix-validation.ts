import { isValidCoordinate, type Coordinates } from './geo';
import type { LocationIngestLimits } from './location.config';

/**
 * Whether a single reported fix is worth storing.
 *
 * A phone can hand us a position from a cold GPS chip, a timestamp from a clock the driver set
 * by hand, or a fix buffered so long ago that it describes last week. Each of those is refused
 * here, with a reason, so the reason can be reported and counted rather than guessed at.
 *
 * Note what is *not* validated here: identity. Which driver and which vehicle a fix belongs to
 * is never read from the request — it is resolved from the authenticated session and the
 * driver's open assignment. See LocationsService.
 */

export type FixRejection =
  | 'coordinates'
  | 'accuracy'
  | 'timestamp'
  | 'future'
  | 'too-old';

export interface FixCandidate {
  position: Coordinates;
  recordedAt: Date;
  accuracyMeters: number | null;
}

export type FixValidation = { ok: true } | { ok: false; reason: FixRejection; message: string };

export function validateFix(fix: FixCandidate, limits: LocationIngestLimits, now: Date): FixValidation {
  if (!isValidCoordinate(fix.position)) {
    return { ok: false, reason: 'coordinates', message: 'The reported coordinates are not a valid position.' };
  }

  if (fix.accuracyMeters !== null) {
    if (!Number.isFinite(fix.accuracyMeters) || fix.accuracyMeters < 0) {
      return { ok: false, reason: 'accuracy', message: 'The reported accuracy is not a valid distance.' };
    }
    if (fix.accuracyMeters > limits.maxAccuracyMeters) {
      return { ok: false, reason: 'accuracy', message: `The fix is accurate only to ${Math.round(fix.accuracyMeters)} m, which is too imprecise to store.` };
    }
  }

  const recorded = fix.recordedAt.getTime();
  if (!Number.isFinite(recorded)) {
    return { ok: false, reason: 'timestamp', message: 'The capture timestamp is not a valid date.' };
  }

  // A clock running ahead would let a device pin itself to the top of every "latest fix"
  // comparison for ever, so a fix from the future is refused rather than clamped.
  if (recorded - now.getTime() > limits.maxClockSkewMinutes * 60_000) {
    return { ok: false, reason: 'future', message: 'The capture timestamp is in the future; check the device clock.' };
  }

  if (now.getTime() - recorded > limits.maxBacklogHours * 3_600_000) {
    return { ok: false, reason: 'too-old', message: `The fix is older than ${limits.maxBacklogHours} hours and is no longer useful.` };
  }

  return { ok: true };
}

/**
 * Whether an incoming fix is newer than what the current-location row already holds.
 *
 * This is the guard that stops a late-arriving buffered fix from dragging a driver's marker
 * backwards on the map. History keeps every fix; the current row only ever moves forward.
 * Equal timestamps do not advance it — a re-sent fix is not new information.
 */
export function isNewerThanCurrent(incomingRecordedAt: Date, currentRecordedAt: Date | null): boolean {
  if (!currentRecordedAt) return true;
  return incomingRecordedAt.getTime() > currentRecordedAt.getTime();
}
