import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

/** How long a handoff code stays usable. Long enough to open a page, too short to be worth stealing. */
export const WEB_HANDOFF_TTL_MS = 60_000;

interface PendingHandoff {
  userId: string;
  companyId: string;
  /** The account's session version when the code was issued; a later change voids the code. */
  sessionVersion: number;
  expiresAt: number;
}

/**
 * One-time codes that let the phone app open the office console already signed in, without a
 * token ever appearing in a URL. A code is 256 random bits, kept only as its SHA-256 hash, valid
 * for a minute and consumed by its first use — right or wrong.
 *
 * Held in memory: the API runs as a single instance, and a code lost to a restart costs one
 * retry. An account holds at most one pending code, so the map cannot grow without bound.
 */
@Injectable()
export class WebHandoffStore {
  private readonly pending = new Map<string, PendingHandoff>();

  issue(user: { id: string; companyId: string; sessionVersion: number }, now = Date.now()): { code: string; expiresAt: Date } {
    this.sweep(now);
    for (const [key, entry] of this.pending) if (entry.userId === user.id) this.pending.delete(key);

    const code = randomBytes(32).toString('base64url');
    const expiresAt = now + WEB_HANDOFF_TTL_MS;
    this.pending.set(hash(code), { userId: user.id, companyId: user.companyId, sessionVersion: user.sessionVersion, expiresAt });
    return { code, expiresAt: new Date(expiresAt) };
  }

  /** Removes the code whatever happens next, and returns what it was issued for if still in time. */
  consume(code: string, now = Date.now()): PendingHandoff | null {
    const key = hash(code);
    const entry = this.pending.get(key);
    this.pending.delete(key);
    if (!entry || entry.expiresAt <= now) return null;
    return entry;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(key);
  }
}

const hash = (code: string): string => createHash('sha256').update(code).digest('hex');
