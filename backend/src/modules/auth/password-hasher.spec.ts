import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(hasher.verify('wrong password', hash)).resolves.toBe(false);
  });

  it('salts each hash so identical passwords differ', async () => {
    const [a, b] = await Promise.all([hasher.hash('same-password'), hasher.hash('same-password')]);
    expect(a).not.toEqual(b);
    await expect(hasher.verify('same-password', a)).resolves.toBe(true);
  });

  it('never stores the password in the hash', async () => {
    const hash = await hasher.hash('plaintext-secret');
    expect(hash).not.toContain('plaintext-secret');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
  });

  it('returns false for malformed stored hashes instead of throwing', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$32768$8$1$c2FsdA==$aGFzaA==', 'scrypt$x$8$1$c2FsdA==$aGFzaA==']) {
      await expect(hasher.verify('any', bad)).resolves.toBe(false);
    }
  });

  it('treats unicode-equivalent passwords consistently', async () => {
    const hash = await hasher.hash('café');
    await expect(hasher.verify('cafe\u0301', hash)).resolves.toBe(true);
  });
});
