import { Injectable } from '@nestjs/common';

/**
 * Per-driver ingestion ceiling.
 *
 * Location is the one endpoint a device calls on a timer, so a phone stuck in a retry loop —
 * or an app shipped with a bad interval — could otherwise bury the database in writes. The
 * limit is counted per driver rather than per IP on purpose: every driver on a mobile network
 * shares a handful of carrier NAT addresses, so an IP-based limit would throttle a whole depot
 * because one phone misbehaved.
 *
 * A sliding window of fix counts, held in memory. That is the right scope for a single-process
 * modular monolith and costs nothing; if the API is ever run as several instances behind a load
 * balancer, each instance would allow the full rate, and this needs to move to a shared store
 * (Redis, or a small Postgres counter). The ceiling is generous — many times the configured
 * reporting interval — so it only ever catches a genuine fault, never normal tracking.
 */

interface Window {
  /** Start of the current minute-long window, in epoch ms. */
  startedAt: number;
  fixes: number;
}

const WINDOW_MS = 60_000;
/** Windows for drivers that have gone quiet are swept so the map cannot grow without bound. */
const SWEEP_AFTER_MS = 10 * WINDOW_MS;

export interface ThrottleDecision {
  allowed: boolean;
  /** Fixes still permitted in the current window. */
  remaining: number;
  /** Seconds until the window resets, for a Retry-After header. */
  retryAfterSeconds: number;
}

@Injectable()
export class LocationIngestThrottle {
  private readonly windows = new Map<string, Window>();
  private lastSweep = 0;

  /**
   * Records an attempt to submit `fixes` fixes for one driver and says whether it may proceed.
   * A batch that would cross the ceiling is refused whole rather than partly accepted, so the
   * device can retry the same batch unchanged — the idempotency key makes that safe.
   */
  check(driverId: string, fixes: number, limitPerMinute: number, now: number = Date.now()): ThrottleDecision {
    this.sweep(now);

    const window = this.windows.get(driverId);
    if (!window || now - window.startedAt >= WINDOW_MS) {
      const allowed = fixes <= limitPerMinute;
      if (allowed) this.windows.set(driverId, { startedAt: now, fixes });
      return {
        allowed,
        remaining: Math.max(0, limitPerMinute - (allowed ? fixes : 0)),
        retryAfterSeconds: allowed ? 0 : Math.ceil(WINDOW_MS / 1000),
      };
    }

    if (window.fixes + fixes > limitPerMinute) {
      return {
        allowed: false,
        remaining: Math.max(0, limitPerMinute - window.fixes),
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000)),
      };
    }

    window.fixes += fixes;
    return { allowed: true, remaining: limitPerMinute - window.fixes, retryAfterSeconds: 0 };
  }

  /** Test seam: forget everything recorded so far. */
  reset(): void {
    this.windows.clear();
    this.lastSweep = 0;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_AFTER_MS) return;
    this.lastSweep = now;
    for (const [driverId, window] of this.windows) {
      if (now - window.startedAt > SWEEP_AFTER_MS) this.windows.delete(driverId);
    }
  }
}
