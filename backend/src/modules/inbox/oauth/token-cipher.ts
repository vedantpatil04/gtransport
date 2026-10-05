import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for mailbox OAuth tokens.
 *
 * A refresh token is a standing key to the company's mail. It is encrypted with AES-256-GCM under
 * EMAIL_TOKEN_ENCRYPTION_KEY before it reaches PostgreSQL, so a database dump or a backup on its
 * own does not open the mailbox. GCM authenticates as well as encrypts: a tampered or truncated
 * value fails to decrypt instead of producing garbage that is then sent to Google or Microsoft.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64. The version prefix lets the scheme
 * change later without guessing what an old value is.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('The token encryption key must be 32 bytes (base64-encoded).');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(value: string): string {
    const [version, iv, tag, data] = value.split(':');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unrecognised token format.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
