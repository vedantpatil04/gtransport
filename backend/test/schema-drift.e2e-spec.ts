import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * The production Finance failure, reproduced: the code selects `payment_records.remarks` (added by
 * migration 20261008000000) but the live database had not been migrated. Tab counts — a groupBy that
 * never touches the new column — loaded, while the list answered a bare 500 "An unexpected database
 * error occurred.". This temporarily hides that column in the disposable test database to prove the
 * API now answers 503 with a reference id, keeps unrelated endpoints working, and recovers as soon as
 * the column is back — without touching any stored payment.
 */
describe('database behind the code (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let admin: string;
  let paymentId: string;

  const V = '/api/v1';
  const api = () => request(app.getHttpServer());
  const get = (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${admin}`);

  const hideColumn = () => prisma.$executeRawUnsafe('ALTER TABLE payment_records RENAME COLUMN remarks TO remarks_hidden_by_test');
  const restoreColumn = async () => {
    const hidden = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      "SELECT column_name::text AS column_name FROM information_schema.columns WHERE table_name = 'payment_records' AND column_name = 'remarks_hidden_by_test'",
    );
    if (hidden.length) await prisma.$executeRawUnsafe('ALTER TABLE payment_records RENAME COLUMN remarks_hidden_by_test TO remarks');
  };

  beforeAll(async () => {
    prisma = rawPrisma();
    await restoreColumn(); // a previous run that died half-way must not poison this one
    seed = await seedCompany(prisma);
    app = await createTestApp();
    admin = (await api().post(`${V}/auth/login`).send({ identifier: seed.admin.identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;
    const payment = await prisma.paymentRecord.create({
      data: { companyId: seed.company.id, employeeId: seed.driver.employeeId, type: 'ALLOWANCE', amount: '1500.00', status: 'PENDING_APPROVAL', method: 'CASH', provider: 'MANUAL', description: 'Drift check' },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    await restoreColumn();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('answers 503 with a reference id — not a bare 500 — and keeps the tab counts working', async () => {
    await hideColumn();
    try {
      const list = await get('/payments?limit=25').expect(503);
      expect(list.body.error).toMatchObject({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
      expect(list.body.error.message).toMatch(/being updated/i);
      expect(list.body.error.requestId).toEqual(expect.any(String));
      expect(JSON.stringify(list.body)).not.toMatch(/remarks|prisma|column/i);

      // The counts never read the missing column, which is why the real page showed them above the error.
      const summary = await get('/payments/summary').expect(200);
      expect(summary.body.byStatus.PENDING_APPROVAL.count).toBe(1);
    } finally {
      await restoreColumn();
    }
  });

  it('recovers on its own once the database has the column, with the stored payment untouched', async () => {
    const list = await get('/payments?limit=25').expect(200);
    const row = list.body.data.find((payment: { id: string }) => payment.id === paymentId);
    expect(row).toMatchObject({ amount: '1500.00', status: 'PENDING_APPROVAL', remarks: null });
  });

  it('reports the schema state on the health probe', async () => {
    const health = await api().get('/health').expect(200);
    expect(health.body.checks).toEqual({ database: 'up', schema: 'current' });
    expect(health.body.status).toBe('ok');
    expect(health.body.pendingMigrations).toBeUndefined();
  });
});
