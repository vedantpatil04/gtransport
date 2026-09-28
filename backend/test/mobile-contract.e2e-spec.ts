import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { todayInIndia, toIsoDate } from '../src/common/dates/financial-year';
import { createTestApp, rawPrisma, seedCompany, TEST_PASSWORD } from './app-fixture';

/**
 * The driver app's contract with the API.
 *
 * Phase 2 shipped a mobile login that read `expiresIn` while the API sent `expiresAt`. Unit
 * tests passed because they mocked the shape the app assumed, not the one the API returns.
 *
 * This suite pins the exact response shapes the mobile app reads. If a field is renamed or
 * removed, it fails here — in the backend — instead of on a driver's phone.
 *
 * Run with CAPTURE_CONTRACTS=1 to refresh the real responses the mobile tests replay
 * (mobile/src/lib/__tests__/contracts/*.json).
 */
const CONTRACT_DIR = path.resolve(__dirname, '../../mobile/src/lib/__tests__/contracts');

/** Tokens are replaced before writing: fixtures are committed, and credentials never should be. */
function redact(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body), (key, value) => (key === 'accessToken' ? 'redacted-test-access-token' : value));
}

function capture(name: string, body: unknown): void {
  if (process.env.CAPTURE_CONTRACTS !== '1') return;
  mkdirSync(CONTRACT_DIR, { recursive: true });
  writeFileSync(path.join(CONTRACT_DIR, `${name}.json`), `${JSON.stringify(redact(body), null, 2)}\n`);
}

const keys = (value: object) => Object.keys(value).sort();

describe('mobile contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedCompany>>;
  let token: string;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    prisma = rawPrisma();
    seed = await seedCompany(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('login returns an absolute expiresAt and the user the session store reads', async () => {
    const response = await api().post('/api/v1/auth/login').send({ identifier: seed.driver.identifier, password: TEST_PASSWORD }).expect(200);
    token = response.body.accessToken;

    expect(keys(response.body)).toEqual(['accessToken', 'expiresAt', 'expiresIn', 'user']);
    expect(Date.parse(response.body.expiresAt)).toBeGreaterThan(Date.now());
    // One session shape for every role: the role decides which app the phone shows.
    expect(keys(response.body.user)).toEqual([
      'companyId', 'displayName', 'driverId', 'email', 'employeeId', 'id', 'mustChangePassword', 'phone', 'role', 'status',
    ]);
    expect(response.body.user).toMatchObject({ role: 'DRIVER', status: 'ACTIVE', mustChangePassword: false });
    expect(response.body.user.displayName).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|sessionVersion/);
    capture('login', response.body);
  });

  it('GET /auth/me returns the same account profile, read fresh after a restart', async () => {
    const response = await api().get('/api/v1/auth/me').set(auth()).expect(200);
    expect(keys(response.body)).toEqual([
      'companyId', 'displayName', 'driverId', 'email', 'employeeId', 'id', 'mustChangePassword', 'phone', 'role', 'status',
    ]);
    expect(response.body.role).toBe('DRIVER');
    capture('auth-me', response.body);
  });

  it('GET /drivers/me returns the profile the driver screens read', async () => {
    const response = await api().get('/api/v1/drivers/me').set(auth()).expect(200);

    for (const field of ['id', 'driverCode', 'status', 'employee', 'currentAssignment', 'emergencyContact', 'location']) {
      expect(response.body).toHaveProperty(field);
    }
    expect(response.body.employee).toEqual(
      expect.objectContaining({ fullName: expect.any(String), employeeCode: expect.any(String), preferredLanguage: expect.any(String) }),
    );
    expect(response.body.currentAssignment.vehicle).toEqual(expect.objectContaining({ registrationNumber: expect.any(String) }));
    capture('driver-me', response.body);
  });

  it('POST /fuel/mine returns the entry shape with a server-derived rate', async () => {
    const response = await api()
      .post('/api/v1/fuel/mine')
      .set(auth())
      .send({ fuelType: 'DIESEL', amount: 2450, litres: 25, fuelStation: 'IndianOil', transactionDate: toIsoDate(todayInIndia()), clientSubmissionId: `contract-${Date.now()}` })
      .expect(201);

    for (const field of ['id', 'fuelType', 'amount', 'litres', 'ratePerLitre', 'fuelStation', 'transactionDate', 'receiptFileId', 'clientSubmissionId', 'driver', 'vehicle']) {
      expect(response.body).toHaveProperty(field);
    }
    // Money travels as strings so no precision is lost in JSON.
    expect(typeof response.body.amount).toBe('string');
    expect(response.body.ratePerLitre).toBe('98.00');
    capture('fuel-create', response.body);
  });

  it('GET /fuel/mine returns a page with totals', async () => {
    const today = toIsoDate(todayInIndia());
    const response = await api().get('/api/v1/fuel/mine').query({ from: today, to: today }).set(auth()).expect(200);

    expect(keys(response.body)).toEqual(['data', 'page', 'totals']);
    expect(keys(response.body.totals)).toEqual(['amount', 'averageRate', 'entries', 'litres']);
    expect(keys(response.body.page)).toEqual(['limit', 'nextCursor']);
    capture('fuel-list', response.body);
  });

  it('GET /operations/mine returns a page with a total', async () => {
    await api()
      .post('/api/v1/operations/mine')
      .set(auth())
      .send({ category: 'MAINTENANCE', amount: 8500, expenseDate: toIsoDate(todayInIndia()), vendorName: 'Belagavi Service Centre' })
      .expect(201);
    const response = await api().get('/api/v1/operations/mine').set(auth()).expect(200);

    expect(keys(response.body)).toEqual(['data', 'page', 'total']);
    capture('operations-list', response.body);
  });

  it('receipt upload returns the file id the queue attaches', async () => {
    const response = await api()
      .post('/api/v1/files/receipts')
      .set(auth())
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, Date.now() % 255]), { filename: 'r.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(keys(response.body)).toEqual(['deduplicated', 'fileId']);
    capture('receipt-upload', response.body);
  });

  it('GET /documents/mine returns the compliance matrix the Documents tab reads', async () => {
    const response = await api().get('/api/v1/documents/mine').set(auth()).expect(200);

    expect(keys(response.body)).toEqual(['personal', 'vehicle']);
    expect(response.body.vehicle.documents.map((item: { type: string }) => item.type)).toEqual(['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE']);
    for (const item of [...response.body.vehicle.documents, ...response.body.personal]) {
      expect(keys(item)).toEqual(['daysRemaining', 'document', 'status', 'type']);
    }
    // Present documents carry the fields each card reads; missing ones are null with NOT_UPLOADED.
    const present = response.body.vehicle.documents.find((item: { document: unknown }) => item.document);
    for (const field of ['id', 'type', 'status', 'daysRemaining', 'verificationStatus', 'rejectionReason', 'expiryDate', 'file']) {
      expect(present.document).toHaveProperty(field);
    }
    expect(response.body.vehicle.documents.find((item: { document: unknown }) => !item.document).status).toBe('NOT_UPLOADED');
    capture('documents-mine', response.body);
  });

  it('GET /payments/mine returns only what the Payments tab reads — no provider internals', async () => {
    const admin = (await api().post('/api/v1/auth/login').send({ identifier: seed.admin.identifier, password: TEST_PASSWORD }).expect(200)).body.accessToken as string;
    const office = { Authorization: `Bearer ${admin}` };
    const paid = (await api().post('/api/v1/payments').set(office).send({ employeeId: seed.driver.employeeId, type: 'ALLOWANCE', method: 'CASH', provider: 'MANUAL', amount: 1250.5, description: 'Festival allowance' }).expect(201)).body;
    await api().post(`/api/v1/payments/${paid.id}/approve`).set(office).expect(200);
    await api().post(`/api/v1/payments/${paid.id}/record-manual`).set(office).send({ reference: 'CASH-042' }).expect(200);
    await api().post('/api/v1/payments').set(office).send({ employeeId: seed.driver.employeeId, type: 'OTHER', method: 'CASH', provider: 'MANUAL', amount: 300 }).expect(201);

    const response = await api().get('/api/v1/payments/mine').set(auth()).expect(200);
    expect(keys(response.body)).toEqual(['data', 'page']);
    for (const item of response.body.data) {
      expect(keys(item)).toEqual(['amount', 'createdAt', 'description', 'id', 'method', 'paidAt', 'payPeriod', 'recipientSummary', 'status', 'type', 'utr']);
    }
    const received = response.body.data.find((item: { id: string }) => item.id === paid.id);
    expect(received).toMatchObject({ status: 'PAID', amount: '1250.50', utr: 'CASH-042' });
    expect(response.body.data.find((item: { status: string }) => item.status === 'PENDING_APPROVAL').utr).toBeNull();
    capture('payments-mine', response.body);
  });

  // ── Phase 6: location ──

  it('the tracking state report returns the policy the app must follow', async () => {
    const response = await api()
      .patch('/api/v1/drivers/me/location-state')
      .set(auth())
      .send({ permission: 'GRANTED_ALWAYS', locationServicesEnabled: true, trackingState: 'TRACKING_ACTIVE', pendingUploads: 0 })
      .expect(200);

    expect(keys(response.body)).toEqual(['pendingUploads', 'permission', 'status', 'trackingPolicy', 'trackingState']);
    expect(keys(response.body.trackingPolicy)).toEqual([
      'bufferLimit', 'distanceMeters', 'maxBatchSize', 'movingIntervalSeconds', 'staleAfterMinutes', 'stationaryIntervalSeconds',
    ]);
    // The app spaces its fixes by these numbers, so a rename here would silently stop tracking.
    expect(response.body.trackingPolicy.movingIntervalSeconds).toEqual(expect.any(Number));
    expect(response.body.trackingState).toBe('TRACKING_ACTIVE');
    capture('location-state', response.body);
  });

  it('submitting fixes answers with a per-fix outcome the offline buffer acts on', async () => {
    const fix = (id: string, minutesAgo: number) => ({
      latitude: 15.85,
      longitude: 74.498,
      capturedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      accuracyMeters: 9,
      speedKmh: 44,
      headingDeg: 190,
      clientSubmissionId: id,
    });
    const stamp = Date.now();
    const first = fix(`contract-${stamp}-a`, 4);

    const response = await api()
      .post('/api/v1/locations')
      .set(auth())
      .send({ fixes: [first, fix(`contract-${stamp}-b`, 2)], pendingUploads: 0, trackingState: 'TRACKING_ACTIVE' })
      .expect(200);

    expect(keys(response.body)).toEqual(['alertRaised', 'duplicates', 'rejected', 'results', 'state', 'stored']);
    expect(keys(response.body.results[0])).toEqual(['clientSubmissionId', 'outcome']);
    expect(response.body).toMatchObject({ stored: 2, duplicates: 0, rejected: 0 });
    capture('locations-submit', response.body);

    // The buffer's whole safety model rests on this: a replay reports 'duplicate', not an error,
    // so the app can drop the fix instead of retrying it for ever.
    const replay = await api().post('/api/v1/locations').set(auth()).send({ fixes: [first] }).expect(200);
    expect(replay.body.results[0]).toEqual({ clientSubmissionId: first.clientSubmissionId, outcome: 'duplicate' });
    capture('locations-duplicate', replay.body);
  });

  it('a fix the server will never accept is reported as rejected, with a reason', async () => {
    const response = await api()
      .post('/api/v1/locations')
      .set(auth())
      .send({ fixes: [{ latitude: 0, longitude: 0, capturedAt: new Date().toISOString(), clientSubmissionId: `contract-bad-${Date.now()}` }] })
      .expect(200);

    expect(response.body.results[0]).toMatchObject({ outcome: 'rejected', reason: 'coordinates', message: expect.any(String) });
    // Without a reason the app cannot tell "retry later" from "never", and would retry for ever.
    capture('locations-rejected', response.body);
  });

  it('a driver reads their own fixes and nobody else\'s', async () => {
    const response = await api().get('/api/v1/locations/mine?limit=5').set(auth()).expect(200);

    expect(keys(response.body)).toEqual(['data', 'page']);
    for (const item of response.body.data) {
      expect(keys(item)).toEqual([
        'accuracyMeters', 'altitudeMeters', 'batteryPct', 'capturedAt', 'headingDeg', 'id', 'latitude', 'longitude', 'provider', 'receivedAt', 'speedKmh', 'vehicleId',
      ]);
    }
    // Coordinates cross the wire as numbers, not Decimal strings: the map consumes numbers.
    if (response.body.data.length) expect(typeof response.body.data[0].latitude).toBe('number');
    capture('locations-mine', response.body);
  });

  it('an API error arrives in the envelope the mobile client maps', async () => {
    const response = await api().post('/api/v1/fuel/mine').set(auth()).send({ fuelType: 'DIESEL' }).expect(400);

    expect(keys(response.body)).toEqual(['error']);
    expect(response.body.error).toEqual(expect.objectContaining({ message: expect.any(String), code: expect.any(String), requestId: expect.any(String) }));
    capture('error-validation', response.body);
  });
});
