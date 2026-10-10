import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/** Password guessing is slowed per account and address, without ever locking a legitimate driver out. */
describe('sign-in attempt limit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;

  const login = (identifier: string, password: string) => request(app.getHttpServer()).post('/api/v1/auth/login').send({ identifier, password });

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('stops after ten wrong passwords for one account — even the right password has to wait — and says so plainly', async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) await login(seed.driver.identifier, `wrong-password-${attempt}`).expect(401);

    const blocked = await login(seed.driver.identifier, TEST_PASSWORD).expect(429);
    expect(blocked.body.error).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(blocked.body.error.message).toMatch(/Too many failed sign-in attempts\. Please wait \d+ minutes? and try again\./);
    expect(blocked.body.error.requestId).toEqual(expect.any(String));
  });

  it('does not stop other accounts from the same address', async () => {
    await login(seed.admin.identifier, TEST_PASSWORD).expect(200);
  });

  it('counts only failures: any number of correct sign-ins is fine, and a success clears earlier mistakes', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await login(seed.admin.identifier, 'typo-password-one').expect(401);
    await login(seed.admin.identifier, TEST_PASSWORD).expect(200);
    for (let attempt = 0; attempt < 5; attempt += 1) await login(seed.admin.identifier, 'typo-password-two').expect(401);
    await login(seed.admin.identifier, TEST_PASSWORD).expect(200);
    for (let attempt = 0; attempt < 10; attempt += 1) await login(seed.admin.identifier, TEST_PASSWORD).expect(200);
  });
});
