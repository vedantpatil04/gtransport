import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { todayInIndia, toIsoDate } from '../src/common/dates/financial-year';
import { ComplianceService } from '../src/modules/compliance/compliance.service';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * Phase 4 end-to-end: documents and compliance through real HTTP against real PostgreSQL.
 */
describe('Phase 4 — documents and compliance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let adminToken: string;
  let driverToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = todayInIndia();
  const inDays = (n: number) => toIsoDate(new Date(today.getTime() + n * 86_400_000));

  const login = async (identifier: string) =>
    (await api().post('/api/v1/auth/login').send({ identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;

  const upload = async (token: string, label = 'doc') => {
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.from(`${label}-${Date.now()}-${Math.random()}`)]);
    const response = await api().post('/api/v1/files/documents').set(auth(token)).attach('file', bytes, { filename: `${label}.pdf`, contentType: 'application/pdf' }).expect(201);
    return response.body.fileId as string;
  };

  /** A fresh vehicle so status tests are not affected by other tests' documents. */
  const newVehicle = async () =>
    (
      await api()
        .post('/api/v1/vehicles')
        .set(auth(adminToken))
        .send({ registrationNumber: `KA 22 DC ${Math.floor(1000 + Math.random() * 8999)}`, kind: 'TRUCK', fuelType: 'DIESEL' })
        .expect(201)
    ).body.id as string;

  const officeDoc = async (vehicleId: string, type: string, expiryDate?: string) => {
    // Upload first: awaiting one request while another is being built makes them collide.
    const fileId = await upload(adminToken, type);
    return (
      await api()
        .post('/api/v1/documents')
        .set(auth(adminToken))
        .send({ type, vehicleId, fileId, expiryDate, documentNumber: `${type}-1`, issuer: 'RTO Belagavi' })
        .expect(201)
    ).body;
  };

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();
    adminToken = await login(seed.admin.identifier);
    driverToken = await login(seed.driver.identifier);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('status: valid, expiring soon, expired, not uploaded', () => {
    it('reports a missing insurance as NOT_UPLOADED, never as expired', async () => {
      const vehicleId = await newVehicle();
      const matrix = await api().get(`/api/v1/documents/vehicle/${vehicleId}`).set(auth(adminToken)).expect(200);

      const insurance = matrix.body.find((item: { type: string }) => item.type === 'INSURANCE');
      expect(insurance).toMatchObject({ status: 'NOT_UPLOADED', document: null });
      expect(matrix.body.map((item: { type: string }) => item.type)).toEqual(['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE', 'FITNESS', 'PERMIT']);
    });

    it('reports an expired insurance as EXPIRED', async () => {
      const vehicleId = await newVehicle();
      const doc = await officeDoc(vehicleId, 'INSURANCE', inDays(-1));
      expect(doc).toMatchObject({ status: 'EXPIRED', daysRemaining: -1, threshold: 'EXPIRED' });
    });

    it('reports insurance expiring in 7 days as EXPIRING_SOON at the 7-day threshold', async () => {
      const vehicleId = await newVehicle();
      const doc = await officeDoc(vehicleId, 'INSURANCE', inDays(7));
      expect(doc).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 7, threshold: 'DAYS_7' });
    });

    it('treats the expiry date itself as still valid (last day), and a year out as VALID', async () => {
      const a = await officeDoc(await newVehicle(), 'PUC', inDays(0));
      expect(a).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 0, threshold: 'DAYS_1' });
      const b = await officeDoc(await newVehicle(), 'PUC', inDays(365));
      expect(b).toMatchObject({ status: 'VALID', threshold: null });
    });
  });

  describe('driver visibility and upload', () => {
    it('shows the driver their vehicle documents and their own licence, including gaps', async () => {
      const response = await api().get('/api/v1/documents/mine').set(auth(driverToken)).expect(200);

      expect(response.body.vehicle.id).toBe(seed.vehicle.id);
      expect(response.body.vehicle.documents.map((d: { type: string }) => d.type)).toEqual(['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE']);
      expect(response.body.vehicle.documents.find((d: { type: string }) => d.type === 'INSURANCE').document.id).toBe(seed.documents.vehicleInsurance.id);
      expect(response.body.vehicle.documents.find((d: { type: string }) => d.type === 'RC').status).toBe('NOT_UPLOADED');
      expect(response.body.personal[0]).toMatchObject({ type: 'DRIVING_LICENCE' });
      expect(response.body.personal[0].document.id).toBe(seed.documents.ownLicence.id);
    });

    it('never shows the driver another driver\'s documents', async () => {
      await api().get(`/api/v1/documents/${seed.documents.otherLicence.id}`).set(auth(driverToken)).expect(404);
      const list = await api().get('/api/v1/documents').set(auth(driverToken)).expect(200);
      expect(list.body.data.map((d: { id: string }) => d.id)).not.toContain(seed.documents.otherLicence.id);
    });

    it('lets the driver upload a PUC for their vehicle, awaiting verification', async () => {
      const fileId = await upload(driverToken, 'puc');
      const response = await api()
        .post('/api/v1/documents/mine')
        .set(auth(driverToken))
        .send({ type: 'PUC', fileId, expiryDate: inDays(180), documentNumber: 'PUC-7788' })
        .expect(201);

      expect(response.body).toMatchObject({ type: 'PUC', verificationStatus: 'PENDING', status: 'VALID' });
      expect(response.body.vehicle.id).toBe(seed.vehicle.id);
      // Metadata only: the bytes are never in the record.
      expect(response.body.file).toMatchObject({ id: fileId, mimeType: 'application/pdf', fileName: 'puc.pdf' });
      expect(response.body.file.sizeBytes).toBeGreaterThan(0);
    });

    it('refuses an owner supplied by the driver and "Other" documents from the driver', async () => {
      const fileId = await upload(driverToken);
      await api().post('/api/v1/documents/mine').set(auth(driverToken)).send({ type: 'PUC', fileId, vehicleId: seed.vehicle.id }).expect(400);
      await api().post('/api/v1/documents/mine').set(auth(driverToken)).send({ type: 'OTHER', fileId }).expect(400);
    });

    it('does not let a driver verify, reject or archive', async () => {
      const id = seed.documents.vehicleInsurance.id;
      await api().post(`/api/v1/documents/${id}/verify`).set(auth(driverToken)).expect(403);
      await api().post(`/api/v1/documents/${id}/reject`).set(auth(driverToken)).send({ reason: 'x' }).expect(403);
      await api().post(`/api/v1/documents/${id}/archive`).set(auth(driverToken)).send({ reason: 'x' }).expect(403);
    });

    it('lets the driver open their vehicle\'s document file uploaded by the office', async () => {
      const fileId = await upload(adminToken, 'rc');
      await api().post('/api/v1/documents').set(auth(adminToken)).send({ type: 'RC', vehicleId: seed.vehicle.id, fileId }).expect(201);
      await api().get(`/api/v1/files/${fileId}/content`).set(auth(driverToken)).expect(200);
    });

    it('blocks the driver from another vehicle\'s document file', async () => {
      const doc = await officeDoc(await newVehicle(), 'RC');
      await api().get(`/api/v1/files/${doc.file.id}/content`).set(auth(driverToken)).expect(403);
    });
  });

  describe('replacement keeps history', () => {
    it('supersedes the previous version, keeps its file, and audits both references', async () => {
      const vehicleId = await newVehicle();
      const first = await officeDoc(vehicleId, 'INSURANCE', inDays(10));
      const replacementFile = await upload(adminToken, 'insurance-renewed');

      const second = await api()
        .post(`/api/v1/documents/${first.id}/replace`)
        .set(auth(adminToken))
        .send({ fileId: replacementFile, expiryDate: inDays(375), issuer: 'New India Assurance' })
        .expect(201);

      expect(second.body).toMatchObject({ state: 'CURRENT', status: 'VALID', type: 'INSURANCE' });

      const history = await api().get(`/api/v1/documents/${second.body.id}/history`).set(auth(adminToken)).expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0]).toMatchObject({ id: first.id, state: 'SUPERSEDED' });
      expect(history.body[0].file.id).toBe(first.file.id);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: second.body.id, action: 'document.replaced' } });
      expect(audit.changes).toMatchObject({ previousDocumentId: first.id, previousFileId: first.file.id, fileId: replacementFile });

      // Only the new version counts as current.
      const matrix = await api().get(`/api/v1/documents/vehicle/${vehicleId}`).set(auth(adminToken)).expect(200);
      expect(matrix.body.find((i: { type: string }) => i.type === 'INSURANCE').document.id).toBe(second.body.id);
    });

    it('supersedes the previous tyre insurance when a new policy is recorded (Phase 3 path)', async () => {
      const token = driverToken;
      const a = await api().post('/api/v1/operations/mine/tyre-insurance').set(auth(token)).send({ insurer: 'Old', expiryDate: inDays(20) }).expect(201);
      const b = await api().post('/api/v1/operations/mine/tyre-insurance').set(auth(token)).send({ insurer: 'New', expiryDate: inDays(400) }).expect(201);

      const current = await prisma.document.findMany({ where: { vehicleId: seed.vehicle.id, type: 'TYRE_INSURANCE', state: 'CURRENT' } });
      expect(current.map((d) => d.id)).toEqual([b.body.id]);
      expect((await prisma.document.findUniqueOrThrow({ where: { id: a.body.id } })).supersededById).toBe(b.body.id);
    });

    it('allows only one current document per type per vehicle, even writing directly to the database', async () => {
      const vehicleId = await newVehicle();
      await officeDoc(vehicleId, 'RC');
      await expect(
        prisma.document.create({ data: { companyId: seed.company.id, type: 'RC', ownerType: 'VEHICLE', vehicleId } }),
      ).rejects.toThrow(/Unique constraint/);
    });
  });

  describe('verification and archive', () => {
    it('verifies, rejects with a reason, and archives without deleting', async () => {
      const doc = await officeDoc(await newVehicle(), 'PERMIT', inDays(90));

      const rejected = await api().post(`/api/v1/documents/${doc.id}/reject`).set(auth(adminToken)).send({ reason: 'Photo is blurred' }).expect(200);
      expect(rejected.body).toMatchObject({ verificationStatus: 'REJECTED', rejectionReason: 'Photo is blurred' });

      await api().post(`/api/v1/documents/${doc.id}/reject`).set(auth(adminToken)).send({}).expect(400);

      const verified = await api().post(`/api/v1/documents/${doc.id}/verify`).set(auth(adminToken)).expect(200);
      expect(verified.body).toMatchObject({ verificationStatus: 'VERIFIED', rejectionReason: null });

      const archived = await api().post(`/api/v1/documents/${doc.id}/archive`).set(auth(adminToken)).send({ reason: 'Vehicle permit surrendered' }).expect(200);
      expect(archived.body).toMatchObject({ state: 'ARCHIVED', archiveReason: 'Vehicle permit surrendered' });
      expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);

      const actions = (await prisma.auditLog.findMany({ where: { entityId: doc.id }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['document.uploaded', 'document.rejected', 'document.verified', 'document.archived']));
    });

    it('shows uploader, dates and file details on the document detail', async () => {
      const doc = await officeDoc(await newVehicle(), 'FITNESS', inDays(200));
      const detail = await api().get(`/api/v1/documents/${doc.id}`).set(auth(adminToken)).expect(200);

      expect(detail.body).toMatchObject({ documentNumber: 'FITNESS-1', issuer: 'RTO Belagavi', expiryDate: inDays(200), verificationStatus: 'VERIFIED' });
      expect(detail.body.uploadedBy).toEqual(expect.any(String));
      expect(detail.body.uploadedAt).toEqual(expect.any(String));
    });
  });

  describe('office compliance overview', () => {
    it('counts expired, <7 days, <30 days, valid, not uploaded and pending per type', async () => {
      const company = await seedCompany(prisma);
      const office = await login(company.admin.identifier);
      const make = async (expiryDate: string) => {
        const vehicle = (await api().post('/api/v1/vehicles').set(auth(office)).send({ registrationNumber: `KA 22 SM ${Math.floor(1000 + Math.random() * 8999)}`, kind: 'TRUCK', fuelType: 'DIESEL' }).expect(201)).body.id;
        const fileId = await upload(office);
        await api().post('/api/v1/documents').set(auth(office)).send({ type: 'PUC', vehicleId: vehicle, fileId, expiryDate }).expect(201);
      };
      await make(inDays(-5)); // expired
      await make(inDays(3)); // < 7 days
      await make(inDays(20)); // < 30 days
      await make(inDays(200)); // valid

      const summary = await api().get('/api/v1/documents/summary').set(auth(office)).expect(200);
      const puc = summary.body.find((row: { type: string }) => row.type === 'PUC');

      expect(puc).toMatchObject({ expired: 1, within7Days: 1, expiringSoon: 2, valid: 1 });
      // Five active vehicles (the fixture's plus four), four PUCs: one missing.
      expect(puc.notUploaded).toBe(1);
      expect(summary.body.find((row: { type: string }) => row.type === 'OTHER').notUploaded).toBeNull();
    });

    it('filters by status, type, vehicle and verification', async () => {
      const soon = await api().get('/api/v1/documents').query({ status: 'EXPIRING_SOON' }).set(auth(adminToken)).expect(200);
      expect(soon.body.data.every((d: { status: string }) => d.status === 'EXPIRING_SOON')).toBe(true);

      const expired = await api().get('/api/v1/documents').query({ status: 'EXPIRED', type: 'INSURANCE' }).set(auth(adminToken)).expect(200);
      expect(expired.body.data.every((d: { status: string; type: string }) => d.status === 'EXPIRED' && d.type === 'INSURANCE')).toBe(true);

      const pending = await api().get('/api/v1/documents').query({ verificationStatus: 'PENDING' }).set(auth(adminToken)).expect(200);
      expect(pending.body.data.every((d: { verificationStatus: string }) => d.verificationStatus === 'PENDING')).toBe(true);

      const byVehicle = await api().get('/api/v1/documents').query({ vehicleId: seed.vehicle.id }).set(auth(adminToken)).expect(200);
      expect(byVehicle.body.data.every((d: { vehicle: { id: string } | null }) => d.vehicle?.id === seed.vehicle.id)).toBe(true);
    });

    it('never shows another company\'s documents', async () => {
      const other = await seedCompany(prisma);
      await api().get(`/api/v1/documents/${other.documents.vehicleInsurance.id}`).set(auth(adminToken)).expect(404);
      await api().get(`/api/v1/documents/vehicle/${other.vehicle.id}`).set(auth(adminToken)).expect(404);
    });
  });

  describe('notification-ready expiry events', () => {
    it('records each threshold once and never duplicates on a re-run', async () => {
      const company = await seedCompany(prisma);
      const office = await login(company.admin.identifier);
      const vehicle = (await api().post('/api/v1/vehicles').set(auth(office)).send({ registrationNumber: 'KA 22 EV 0007', kind: 'TRUCK', fuelType: 'DIESEL' }).expect(201)).body.id;
      const fileId = await upload(office);
      const doc = (await api().post('/api/v1/documents').set(auth(office)).send({ type: 'INSURANCE', vehicleId: vehicle, fileId, expiryDate: inDays(5) }).expect(201)).body;

      const first = await api().post('/api/v1/compliance/expiry-events/scan').set(auth(office)).expect(200);
      expect(first.body.recorded).toBeGreaterThanOrEqual(1);
      const second = await api().post('/api/v1/compliance/expiry-events/scan').set(auth(office)).expect(200);
      expect(second.body.recorded).toBe(0);

      const events = await prisma.documentExpiryEvent.findMany({ where: { documentId: doc.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ threshold: 'DAYS_7', daysRemaining: 5, notifiedAt: null });

      const feed = await api().get('/api/v1/compliance/expiry-events').set(auth(office)).expect(200);
      expect(feed.body.some((e: { document: { id: string } }) => e.document.id === doc.id)).toBe(true);
    });

    it('records a new threshold as the date approaches', async () => {
      const company = await seedCompany(prisma);
      const vehicle = await prisma.vehicle.create({ data: { companyId: company.company.id, registrationNumber: 'KA 22 EV 0008', kind: 'TRUCK', fuelType: 'DIESEL' } });
      const doc = await prisma.document.create({
        data: { companyId: company.company.id, type: 'PUC', ownerType: 'VEHICLE', vehicleId: vehicle.id, expiryDate: new Date(`${inDays(10)}T00:00:00.000Z`) },
      });
      const scanner = app.get(ComplianceService);

      await scanner.scanExpiryEvents(today, company.company.id);
      await scanner.scanExpiryEvents(new Date(today.getTime() + 8 * 86_400_000), company.company.id); // 2 days left
      await scanner.scanExpiryEvents(new Date(today.getTime() + 11 * 86_400_000), company.company.id); // expired

      const thresholds = (await prisma.documentExpiryEvent.findMany({ where: { documentId: doc.id }, orderBy: { detectedAt: 'asc' } })).map((e) => e.threshold);
      expect(thresholds).toEqual(['DAYS_15', 'DAYS_3', 'EXPIRED']);
    });
  });
});
