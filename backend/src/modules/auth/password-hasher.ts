import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP-aligned scrypt parameters (N=2^15, r=8, p=1). */
const PARAMS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Password hashing with Node's built-in scrypt — no native build step, which keeps
 * installs reliable across developer machines and the deployment target.
 * Format: scrypt$N$r$p$<salt-base64>$<hash-base64>
 */
@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
    return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
  }

  /** Constant-time comparison. Returns false for malformed stored hashes rather than throwing. */
  async verify(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, rawN, rawR, rawP, saltB64, hashB64] = parts;
    const N = Number(rawN);
    const r = Number(rawR);
    const p = Number(rawP);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const expected = Buffer.from(hashB64, 'base64');
    if (expected.length === 0) return false;

    try {
      const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
        N,
        r,
        p,
        maxmem: PARAMS.maxmem,
      });
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
