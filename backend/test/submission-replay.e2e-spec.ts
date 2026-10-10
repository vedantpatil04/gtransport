import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { todayInIndia, toIsoDate } from '../src/common/dates/financial-year';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * What the phone's retries depend on: a submission sent again — after a timeout while a sleeping
 * server woke up, a dropped connection, or the sync queue reconnecting — is stored once, never
 * twice, and never refused with an error because the first copy won.
 *
 * Fuel and daily operations already had this covered (phase3). Documents did not: the driver app
 * now retries the document save, and two overlapping sends used to make the second answer 409.
 */
describe('replayed driver submissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let driver: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = (label: string) => `replay-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inDays = (days: number) => toIsoDate(new Date(todayInIndia().getTime() + days * 86_400_000));

  const login = async (identifier: string) =>
    (await api().post('/api/v1/auth/login').send({ identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;

  const upload = async (token: string) => {
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.from(`replay-${Date.now()}-${Math.random()}`)]);
    const response = await api().post('/api/v1/files/documents').set(auth(token)).attach('file', bytes, { filename: 'policy.pdf', contentType: 'application/pdf' }).expect(201);
    return response.body.fileId as string;
  };

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();
    driver = await login(seed.driver.identifier);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('document save', () => {
    it('stores a repeated save once, and answers the repeat with the same document', async () => {
      const fileId = await upload(driver);
      const clientSubmissionId = key('doc');
      const body = { type: 'INSURANCE', fileId, expiryDate: inDays(200), documentNumber: 'POL-1', clientSubmissionId };

      const first = await api().post('/api/v1/documents/mine').set(auth(driver)).send(body).expect(201);
      const repeat = await api().post('/api/v1/documents/mine').set(auth(driver)).send(body).expect(200);

      expect(repeat.body.id).toBe(first.body.id);
      expect(await prisma.document.count({ where: { clientSubmissionId } })).toBe(1);
      // The repeat must not push the first copy into history as if it had been replaced.
      const current = await prisma.document.findUniqueOrThrow({ where: { id: first.body.id } });
      expect(current.state).toBe('CURRENT');
    });

    it('survives overlapping sends of the same submission: one document, no 409 for the loser', async () => {
      const fileId = await upload(driver);
      const clientSubmissionId = key('doc-race');
      const body = { type: 'PUC', fileId, expiryDate: inDays(120), documentNumber: 'PUC-RACE', clientSubmissionId };

      const responses = await Promise.all(Array.from({ length: 5 }, () => api().post('/api/v1/documents/mine').set(auth(driver)).send(body)));

      expect(responses.map((response) => response.status).sort()).not.toContain(409);
      expect(responses.every((response) => response.status === 200 || response.status === 201)).toBe(true);
      expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
      expect(await prisma.document.count({ where: { clientSubmissionId } })).toBe(1);
      // Exactly one current PUC for the vehicle afterwards — the race did not leave two.
      expect(await prisma.document.count({ where: { companyId: seed.company.id, vehicleId: seed.vehicle.id, type: 'PUC', state: 'CURRENT', deletedAt: null } })).toBe(1);
    });

    it('does not let another driver replay someone else\'s submission id', async () => {
      const fileId = await upload(driver);
      const clientSubmissionId = key('doc-owned');
      await api().post('/api/v1/documents/mine').set(auth(driver)).send({ type: 'DRIVING_LICENCE', fileId, clientSubmissionId }).expect(201);

      const stamp = Date.now();
      const employee = await prisma.employee.create({ data: { companyId: seed.company.id, employeeCode: `RP-${stamp}`, fullName: 'Second Driver', role: 'DRIVER' } });
      await prisma.driver.create({ data: { companyId: seed.company.id, employeeId: employee.id, driverCode: `GR-D-RP${stamp % 100000}` } });
      const phone = `+9171${String(stamp).slice(-8)}`;
      await prisma.user.create({
        data: { companyId: seed.company.id, employeeId: employee.id, phone, role: 'DRIVER', passwordHash: await new PasswordHasher().hash(TEST_PASSWORD) },
      });
      const other = await login(phone);
      // Upload first: awaiting one request while another is being built makes them collide.
      const otherFileId = await upload(other);

      await api().post('/api/v1/documents/mine').set(auth(other)).send({ type: 'DRIVING_LICENCE', fileId: otherFileId, clientSubmissionId }).expect(403);
    });
  });

  describe('tyre insurance (a policy plus its ledger line)', () => {
    it('records the policy and its premium once, however many times it is sent', async () => {
      const clientSubmissionId = key('tyre');
      const body = { insurer: 'ICICI Lombard', policyNumber: 'TY-REPLAY', premium: 3200, startDate: '2026-04-01', expiryDate: '2027-03-31', clientSubmissionId };

      const first = await api().post('/api/v1/operations/mine/tyre-insurance').set(auth(driver)).send(body).expect(201);
      const repeat = await api().post('/api/v1/operations/mine/tyre-insurance').set(auth(driver)).send(body).expect(200);

      expect(repeat.body.id).toBe(first.body.id);
      expect(await prisma.document.count({ where: { clientSubmissionId } })).toBe(1);
      expect(await prisma.financeLedgerEntry.count({ where: { companyId: seed.company.id, sourceType: 'DOCUMENT', sourceId: first.body.id } })).toBe(1);
    });
  });

  describe('file upload', () => {
    it('answers a repeated upload of the same bytes with the same file, so a retried upload creates no copy', async () => {
      const bytes = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.from(`same-bytes-${Date.now()}`)]);
      const send = () => api().post('/api/v1/files/receipts').set(auth(driver)).attach('file', bytes, { filename: 'bill.pdf', contentType: 'application/pdf' });

      const first = await send().expect(201);
      const again = await send().expect(201);

      expect(again.body).toMatchObject({ fileId: first.body.fileId, deduplicated: true });
      expect(await prisma.storedFile.count({ where: { companyId: seed.company.id, id: first.body.fileId } })).toBe(1);
    });
  });
});
