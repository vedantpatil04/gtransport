import { randomBytes } from 'node:crypto';
import { TokenCipher } from './token-cipher';

describe('TokenCipher — mailbox tokens at rest', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a token', () => {
    const cipher = new TokenCipher(key);
    const encrypted = cipher.encrypt('1//0refresh-token');
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted).not.toContain('refresh-token');
    expect(cipher.decrypt(encrypted)).toBe('1//0refresh-token');
  });

  it('never produces the same ciphertext twice', () => {
    const cipher = new TokenCipher(key);
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('refuses a tampered value rather than returning garbage', () => {
    const cipher = new TokenCipher(key);
    const [version, iv, tag, data] = cipher.encrypt('secret-token').split(':');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => cipher.decrypt([version, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('cannot be read with a different key', () => {
    const encrypted = new TokenCipher(key).encrypt('secret-token');
    expect(() => new TokenCipher(randomBytes(32).toString('base64')).decrypt(encrypted)).toThrow();
  });

  it('refuses a key of the wrong length', () => {
    expect(() => new TokenCipher(randomBytes(16).toString('base64'))).toThrow('32 bytes');
  });
});
