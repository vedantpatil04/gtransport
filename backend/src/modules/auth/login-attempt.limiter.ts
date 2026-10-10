import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Slows password guessing on POST /auth/login. Counts failed attempts in three buckets over a
 * sliding window:
 *
 *   account + address   a few — guessing one account's password from one place
 *   address             many  — one source trying many accounts
 *   account             many  — a spread-out attack on one account
 *
 * The per-account-and-address bucket is what stops guessing, yet cannot be used to lock a victim
 * out from elsewhere: an attacker's failures count against the attacker's address, not the
 * owner's. The address bucket is generous because phones on one mobile carrier often share a
 * public address (CGNAT) — a depot full of drivers must not block each other.
 *
 * Held in memory: the API is a single instance, and a restart forgetting the counts costs the
 * attacker nothing it did not already have. A successful sign-in clears that account's counts.
 * Memory is bounded: expired entries are dropped as they are met, and the table is capped.
 */

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LIMITS = { accountAndAddress: 10, address: 60, account: 60 } as const;
const MAX_TRACKED_KEYS = 10_000;

type Bucket = 'accountAndAddress' | 'address' | 'account';

@Injectable()
export class LoginAttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  /** Throws 429 when this attempt must wait. Call before checking the password. */
  assertAllowed(identifier: string, address: string | null | undefined, now = Date.now()): void {
    let waitMs = 0;
    for (const bucket of Object.keys(LIMITS) as Bucket[]) {
      const key = this.key(bucket, identifier, address);
      const recent = this.recent(key, now);
      if (recent.length >= LIMITS[bucket]) waitMs = Math.max(waitMs, (recent[0] ?? now) + LOGIN_WINDOW_MS - now);
    }
    if (waitMs > 0) {
      const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
      throw new HttpException(
        `Too many failed sign-in attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(identifier: string, address: string | null | undefined, now = Date.now()): void {
    for (const bucket of Object.keys(LIMITS) as Bucket[]) {
      const key = this.key(bucket, identifier, address);
      const recent = this.recent(key, now);
      recent.push(now);
      this.failures.set(key, recent);
    }
    if (this.failures.size > MAX_TRACKED_KEYS) this.evict(now);
  }

  recordSuccess(identifier: string, address: string | null | undefined): void {
    this.failures.delete(this.key('accountAndAddress', identifier, address));
    this.failures.delete(this.key('account', identifier, address));
  }

  private key(bucket: Bucket, identifier: string, address: string | null | undefined): string {
    const account = identifier.trim().toLowerCase();
    const where = address ?? 'unknown';
    return bucket === 'accountAndAddress' ? `pair:${account}|${where}` : bucket === 'address' ? `ip:${where}` : `account:${account}`;
  }

  /** The failures still inside the window; forgets the table entry when none are. */
  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((at) => now - at < LOGIN_WINDOW_MS);
    if (kept.length === 0) this.failures.delete(key);
    return kept;
  }

  private evict(now: number): void {
    for (const key of this.failures.keys()) this.recent(key, now);
    // Still too many (an attack with endless distinct accounts): drop the oldest entries.
    for (const key of this.failures.keys()) {
      if (this.failures.size <= MAX_TRACKED_KEYS) break;
      this.failures.delete(key);
    }
  }
}
