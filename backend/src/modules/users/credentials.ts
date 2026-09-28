import { randomInt } from 'node:crypto';

/**
 * Sign-in identifiers and passwords. No email or SMS provider is involved: a temporary
 * password is generated here, shown to the administrator once, and never stored in clear.
 */

/** No 0/O, 1/l/I: temporary passwords are read out loud or copied by hand. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const DIGITS = '23456789';

/** e.g. "Kp7m-X3qa": 9 characters, at least one letter and one digit, easy to type on a phone. */
export function generateTemporaryPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = Array.from({ length: 8 }, () => pick(ALPHABET));
  // Guarantee a digit and a letter without biasing where they sit.
  chars[randomInt(8)] = pick(DIGITS);
  if (!chars.some((c) => /[A-Za-z]/.test(c))) chars[randomInt(8)] = pick('ABCDEFGHJKMNPQRSTUVWXYZ');
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Minimum rules for a password someone chooses. Deliberately modest — drivers type these on
 * phones — but it refuses the obvious: too short, unchanged, their own sign-in ID, one repeated
 * character.
 */
export function passwordProblem(next: string, context: { current?: string; identifiers?: (string | null | undefined)[] }): string | null {
  if (next.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (next.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (context.current !== undefined && next === context.current) return 'Choose a password different from the current one.';
  if (/^(.)\1*$/.test(next)) return 'Do not repeat one character.';
  const plain = next.toLowerCase().replace(/[\s+-]/g, '');
  for (const id of context.identifiers ?? []) {
    if (!id) continue;
    const idPlain = id.toLowerCase().replace(/[\s+-]/g, '');
    if (plain === idPlain || (idPlain.length >= 10 && plain === idPlain.slice(-10))) return 'Do not use your mobile number or email as the password.';
  }
  return null;
}

/**
 * Indian mobile number → E.164 ("+919845012345"), or null if it is not one. Accepts spaces,
 * dashes, a leading 0, 91 or +91.
 */
export function normaliseMobile(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export function normaliseEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}
