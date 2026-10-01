import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PasswordHasher } from '../src/modules/auth/password-hasher';

/**
 * Phase 6: live fleet and location intelligence, end to end — the real HTTP stack, the real
 * guards and the real PostgreSQL database.
 *
 * The thresholds are pushed down to test values through the environment, so a four-hour stop can
 * be reached in a test without four hours of waiting and without a second code path. Capture
 * timestamps do the rest: durations are measured on the device clock, so a fix can legitimately
 * claim to have been taken hours ago.
 *
 * Configuration is read when the application module is imported, not when it is instantiated, so
 * the fixture is imported dynamically after the environment is set — the same reason Phase 5 does
 * it this way.
 */

/** Test policy: a 100 m radius over 30 minutes. Same code, smaller numbers. */
const RADIUS_METRES = 100;
const DURATION_MINUTES = 30;

describe('Phase 6: live fleet & location intelligence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: typeof import('./app-fixture');
  let seed: Awaited<ReturnType<typeof import('./app-fixture')['seedCompany']>>;
  let admin: string;
  let driver: string;

  const api = () => request(app.getHttpServer());
  const V = '/api/v1';
  const login = async (identifier: string) =>
    (await api().post(`${V}/auth/login`).send({ identifier, password: fixture.TEST_PASSWORD }).expect(200)).body.accessToken as string;
  const as = (token: string) => ({
    get: (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => api().post(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => api().patch(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** A real place on the Gangamata network. */
  const DEPOT = { latitude: 15.85, longitude: 74.498 };
  const northOf = (metres: number, from = DEPOT) => ({ latitude: from.latitude + metres / 111_320, longitude: from.longitude });
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

  let submissionCounter = 0;
  const fix = (overrides: Record<string, unknown> = {}) => ({
    ...DEPOT,
    capturedAt: minutesAgo(1),
    accuracyMeters: 8,
    clientSubmissionId: `e2e-${Date.now()}-${++submissionCounter}`,
    ...overrides,
  });

  const submit = (token: string, fixes: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    as(token).post('/locations', { fixes, ...extra });

  /** Clears the driver's tracking history so each scenario starts from a known state. */
  const resetDriver = async () => {
    await prisma.driverLocationState.updateMany({ where: { driverId: seed.driver.id }, data: { stationaryAlertId: null } });
    await prisma.fleetLocationAlert.deleteMany({ where: { driverId: seed.driver.id } });
    await prisma.driverLocationPing.deleteMany({ where: { driverId: seed.driver.id } });
    await prisma.driverLocationState.deleteMany({ where: { driverId: seed.driver.id } });
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      STATIONARY_RADIUS_METERS: String(RADIUS_METRES),
      STATIONARY_DURATION_MINUTES: String(DURATION_MINUTES),
      STATIONARY_MAX_ACCURACY_METERS: '200',
      LOCATION_STALE_AFTER_MINUTES: '15',
      LOCATION_OFFLINE_AFTER_MINUTES: '30',
      LOCATION_TRACKING_STATIONARY_INTERVAL: '600',
      LOCATION_MAX_FIXES_PER_MINUTE: '5000',
    });

    // require, not a dynamic import: it must run after the environment above is set, and the
    // e2e runner has no VM-modules support. Same pattern as Phase 5.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fixture = require('./app-fixture') as typeof import('./app-fixture');
    prisma = fixture.rawPrisma();
    app = await fixture.createTestApp();
    seed = await fixture.seedCompany(prisma);
    admin = await login(seed.admin.identifier);
    driver = await login(seed.driver.identifier);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────────────────────

  describe('driver submits real locations', () => {
    beforeEach(resetDriver);

    it('stores a fix, updates the current location and appends to history', async () => {
      const response = await submit(driver, [fix({ speedKmh: 48.5, headingDeg: 210, altitudeMeters: 751, batteryPct: 64, provider: 'gps' })]).expect(200);

      expect(response.body).toMatchObject({ stored: 1, duplicates: 0, rejected: 0 });
      expect(response.body.results[0]).toMatchObject({ outcome: 'stored' });

      const current = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(current).not.toBeNull();
      expect(Number(current!.latitude)).toBeCloseTo(DEPOT.latitude, 5);
      expect(Number(current!.longitude)).toBeCloseTo(DEPOT.longitude, 5);
      expect(Number(current!.speedKmh)).toBeCloseTo(48.5, 1);
      expect(current!.status).toBe('ACTIVE');
      // The server stamps its own arrival time as well as keeping the device's capture time.
      expect(current!.receivedAt).not.toBeNull();
      expect(current!.recordedAt).not.toBeNull();

      const history = await prisma.driverLocationPing.findMany({ where: { driverId: seed.driver.id } });
      expect(history).toHaveLength(1);
      expect(history[0]!.provider).toBe('gps');
      // Current state and history are separate records, not one table doing both jobs.
      expect(history[0]!.recordedAt.toISOString()).toBe(current!.recordedAt!.toISOString());
    });

    it('resolves the driver and vehicle server-side, from the session and the open assignment', async () => {
      await submit(driver, [fix()]).expect(200);

      const ping = await prisma.driverLocationPing.findFirst({ where: { driverId: seed.driver.id } });
      expect(ping!.driverId).toBe(seed.driver.id);
      // Nothing in the request said which vehicle: it came from the driver's assignment.
      expect(ping!.vehicleId).toBe(seed.vehicle.id);
      expect(ping!.companyId).toBe(seed.company.id);
    });

    it('refuses a request that tries to name another driver or vehicle', async () => {
      // The fields do not exist on the wire, and unknown properties are rejected outright rather
      // than silently dropped — so an attempt to spoof identity fails loudly.
      await submit(driver, [{ ...fix(), driverId: seed.otherDriver.id } as Record<string, unknown>]).expect(400);
      await submit(driver, [{ ...fix(), vehicleId: seed.vehicle.id } as Record<string, unknown>]).expect(400);

      const forOther = await prisma.driverLocationPing.count({ where: { driverId: seed.otherDriver.id } });
      expect(forOther).toBe(0);
    });

    it('accepts a batch, which is how an offline queue drains', async () => {
      const fixes = [40, 30, 20, 10, 5].map((minutes) => fix({ capturedAt: minutesAgo(minutes), ...northOf(minutes * 30) }));

      const response = await submit(driver, fixes, { pendingUploads: 0 }).expect(200);

      expect(response.body.stored).toBe(5);
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(5);

      // The current position is the newest fix in the batch, not the last one in the array.
      const current = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(current!.recordedAt!.toISOString()).toBe(new Date(fixes[4]!.capturedAt).toISOString());
    });
  });

  describe('idempotency', () => {
    beforeEach(resetDriver);

    it('stores a re-uploaded fix exactly once', async () => {
      const one = fix();

      const first = await submit(driver, [one]).expect(200);
      const second = await submit(driver, [one]).expect(200);

      expect(first.body).toMatchObject({ stored: 1, duplicates: 0 });
      expect(second.body).toMatchObject({ stored: 0, duplicates: 1 });
      expect(second.body.results[0]).toMatchObject({ outcome: 'duplicate' });
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(1);
    });

    it('handles a whole batch replayed after a connection died mid-upload', async () => {
      const fixes = [30, 20, 10].map((m) => fix({ capturedAt: minutesAgo(m) }));
      await submit(driver, fixes).expect(200);

      const replay = await submit(driver, fixes).expect(200);

      expect(replay.body).toMatchObject({ stored: 0, duplicates: 3 });
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(3);
    });

    it('survives two simultaneous retries of the same fix', async () => {
      const one = fix();

      // The unique constraint, not a pre-flight lookup, is what makes this safe: two requests
      // that both pass a lookup cannot both insert.
      const [a, b] = await Promise.all([submit(driver, [one]), submit(driver, [one])]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const outcomes = [a.body.results[0].outcome, b.body.results[0].outcome].sort();
      expect(outcomes).toEqual(['duplicate', 'stored']);
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(1);
    });

    it('keeps the good fixes in a batch that also contains a duplicate', async () => {
      const repeated = fix({ capturedAt: minutesAgo(20) });
      await submit(driver, [repeated]).expect(200);

      const mixed = await submit(driver, [repeated, fix({ capturedAt: minutesAgo(10) }), fix({ capturedAt: minutesAgo(5) })]).expect(200);

      expect(mixed.body).toMatchObject({ stored: 2, duplicates: 1, rejected: 0 });
    });
  });

  describe('data integrity', () => {
    beforeEach(resetDriver);

    it('refuses impossible coordinates while keeping the rest of the batch', async () => {
      const response = await submit(driver, [
        fix({ latitude: 0, longitude: 0, capturedAt: minutesAgo(9) }),
        fix({ capturedAt: minutesAgo(8) }),
      ]).expect(200);

      expect(response.body).toMatchObject({ stored: 1, rejected: 1 });
      expect(response.body.results[0]).toMatchObject({ outcome: 'rejected', reason: 'coordinates' });
      // One bad reading must not lose an hour's worth of queued fixes.
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(1);
    });

    it('refuses a wildly imprecise fix', async () => {
      const response = await submit(driver, [fix({ accuracyMeters: 9_000 })]).expect(200);
      expect(response.body.results[0]).toMatchObject({ outcome: 'rejected', reason: 'accuracy' });
    });

    it('refuses a fix from the future', async () => {
      const response = await submit(driver, [fix({ capturedAt: new Date(Date.now() + 60 * 60_000).toISOString() })]).expect(200);
      expect(response.body.results[0]).toMatchObject({ outcome: 'rejected', reason: 'future' });
    });

    it('refuses coordinates that are not numbers at all', async () => {
      await submit(driver, [{ ...fix(), latitude: 'north' }]).expect(400);
    });

    it('does not let a late older fix drag the current position backwards', async () => {
      const recent = fix({ capturedAt: minutesAgo(2), ...northOf(2_000) });
      await submit(driver, [recent]).expect(200);

      // A fix buffered an hour ago finally uploads, arriving after a newer one.
      const stale = fix({ capturedAt: minutesAgo(60), ...DEPOT });
      await submit(driver, [stale]).expect(200);

      const current = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      // The marker stays where the driver actually is.
      expect(current!.recordedAt!.toISOString()).toBe(new Date(recent.capturedAt).toISOString());
      // But history keeps both: nothing a driver captured is discarded.
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(2);
    });

    it('refuses location updates from a driver who has been stood down', async () => {
      await as(admin).patch(`/drivers/${seed.driver.id}/status`, { status: 'SUSPENDED' }).expect(200);
      await submit(driver, [fix()]).expect(403);

      await as(admin).patch(`/drivers/${seed.driver.id}/status`, { status: 'ACTIVE' }).expect(200);
      // Standing a driver down releases their vehicle, so reactivating needs the truck back.
      await as(admin).post(`/vehicles/${seed.vehicle.id}/assignment`, { driverId: seed.driver.id }).expect(201);
      await submit(driver, [fix()]).expect(200);
    });
  });

  describe('vehicle reassignment', () => {
    beforeEach(resetDriver);

    it('keeps each historical fix attached to the vehicle that was driven at the time', async () => {
      const before = fix({ capturedAt: minutesAgo(30) });
      await submit(driver, [before]).expect(200);

      const other = await prisma.vehicle.create({
        data: { companyId: seed.company.id, registrationNumber: `KA 22 RE ${Date.now() % 10000}`, kind: 'LCV', fuelType: 'DIESEL' },
      });
      await as(admin).post(`/vehicles/${other.id}/assignment`, { driverId: seed.driver.id }).expect(201);

      const after = fix({ capturedAt: minutesAgo(1) });
      await submit(driver, [after]).expect(200);

      const pings = await prisma.driverLocationPing.findMany({ where: { driverId: seed.driver.id }, orderBy: { recordedAt: 'asc' } });
      expect(pings[0]!.vehicleId).toBe(seed.vehicle.id);
      expect(pings[1]!.vehicleId).toBe(other.id);

      // Put the original truck back for the remaining scenarios.
      await as(admin).post(`/vehicles/${seed.vehicle.id}/assignment`, { driverId: seed.driver.id }).expect(201);
    });
  });

  describe('stationary detection and alerts', () => {
    beforeEach(resetDriver);

    /** A stop that has lasted `minutes`, reported the way a parked device actually reports. */
    const parkedFor = (minutes: number, jitterMetres = 15) => [
      fix({ capturedAt: minutesAgo(minutes), ...DEPOT }),
      fix({ capturedAt: minutesAgo(Math.floor(minutes / 2)), ...northOf(jitterMetres) }),
      fix({ capturedAt: minutesAgo(1), ...northOf(-jitterMetres) }),
    ];

    it('raises an alert once a driver has not moved for the configured duration', async () => {
      const response = await submit(driver, parkedFor(DURATION_MINUTES + 5)).expect(200);

      expect(response.body.alertRaised).toBe(true);

      const alerts = await prisma.fleetLocationAlert.findMany({ where: { driverId: seed.driver.id } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ type: 'STATIONARY', status: 'ACTIVE', radiusMeters: RADIUS_METRES });
      expect(alerts[0]!.durationMinutes).toBeGreaterThanOrEqual(DURATION_MINUTES);
      expect(alerts[0]!.vehicleId).toBe(seed.vehicle.id);
      expect(alerts[0]!.stationarySince).not.toBeNull();

      const state = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(state!.stationaryAlertId).toBe(alerts[0]!.id);
      expect(state!.stationarySince).not.toBeNull();
    });

    it('raises no alert before the duration is reached', async () => {
      const response = await submit(driver, parkedFor(DURATION_MINUTES - 10)).expect(200);

      expect(response.body.alertRaised).toBe(false);
      expect(await prisma.fleetLocationAlert.count({ where: { driverId: seed.driver.id } })).toBe(0);

      // The clock is running, though: the office can see how long they have been there.
      const state = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(state!.stationarySince).not.toBeNull();
    });

    it('raises exactly one alert however many fixes arrive during the same stop', async () => {
      await submit(driver, parkedFor(DURATION_MINUTES + 5)).expect(200);

      // Another hour parked in the same spot, reporting every ten minutes.
      for (const minutes of [50, 40, 30, 20, 10, 2]) {
        const later = await submit(driver, [fix({ capturedAt: minutesAgo(minutes), ...northOf(minutes % 20) })]).expect(200);
        expect(later.body.alertRaised).toBe(false);
      }

      expect(await prisma.fleetLocationAlert.count({ where: { driverId: seed.driver.id } })).toBe(1);
    });

    it('is not reset by the jitter a stationary phone reports', async () => {
      // Every fix is within the radius but never in the same place twice — the sequence that
      // breaks a naive previous-point comparison.
      const jitter = [70, 60, 50, 40, 30, 20, 10, 2].map((minutes, index) =>
        fix({ capturedAt: minutesAgo(minutes), ...northOf(index % 2 === 0 ? 20 + index * 4 : -(15 + index * 3)) }),
      );

      const response = await submit(driver, jitter).expect(200);

      expect(response.body.alertRaised).toBe(true);
      expect(await prisma.fleetLocationAlert.count({ where: { driverId: seed.driver.id } })).toBe(1);
    });

    it('clears the stationary state when the driver genuinely moves', async () => {
      await submit(driver, parkedFor(DURATION_MINUTES + 5)).expect(200);
      const raised = await prisma.fleetLocationAlert.findFirstOrThrow({ where: { driverId: seed.driver.id } });

      // Back on the road, well outside the radius.
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...northOf(4_000) })]).expect(200);

      const closed = await prisma.fleetLocationAlert.findUniqueOrThrow({ where: { id: raised.id } });
      // The record survives — the office still needs to know the four-hour stop happened — but
      // the condition it described has ended.
      expect(closed.status).toBe('RESOLVED');
      expect(closed.resolvedReason).toBe('movement');
      expect(closed.movedAt).not.toBeNull();

      const state = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(state!.stationaryAlertId).toBeNull();
    });

    it('lets a second stop raise its own alert after real movement', async () => {
      await submit(driver, parkedFor(DURATION_MINUTES + 5)).expect(200);

      const faraway = northOf(20_000);
      await submit(driver, [
        fix({ capturedAt: minutesAgo(DURATION_MINUTES + 4), ...faraway }),
        fix({ capturedAt: minutesAgo(1), ...faraway }),
      ]).expect(200);

      const alerts = await prisma.fleetLocationAlert.findMany({ where: { driverId: seed.driver.id }, orderBy: { triggeredAt: 'asc' } });
      expect(alerts).toHaveLength(2);
      expect(alerts[1]!.status).toBe('ACTIVE');
    });

    it('takes no notice of a fix too imprecise to judge against the radius', async () => {
      await submit(driver, [
        fix({ capturedAt: minutesAgo(DURATION_MINUTES + 5), ...DEPOT }),
        // A 900 m error radius says nothing about a 100 m question: stored, but not acted on.
        fix({ capturedAt: minutesAgo(15), ...northOf(600), accuracyMeters: 900 }),
        fix({ capturedAt: minutesAgo(1), ...DEPOT }),
      ]).expect(200);

      // The imprecise fix neither reset the period nor prevented the alert.
      expect(await prisma.fleetLocationAlert.count({ where: { driverId: seed.driver.id } })).toBe(1);
      expect(await prisma.driverLocationPing.count({ where: { driverId: seed.driver.id } })).toBe(3);
    });
  });

  describe('alert lifecycle', () => {
    let alertId: string;

    beforeEach(async () => {
      await resetDriver();
      await submit(driver, [
        fix({ capturedAt: minutesAgo(DURATION_MINUTES + 5), ...DEPOT }),
        fix({ capturedAt: minutesAgo(1), ...northOf(10) }),
      ]).expect(200);
      alertId = (await prisma.fleetLocationAlert.findFirstOrThrow({ where: { driverId: seed.driver.id } })).id;
    });

    it('lists active alerts for the office', async () => {
      const response = await as(admin).get('/locations/alerts?status=ACTIVE').expect(200);
      expect(response.body.data.some((a: { id: string }) => a.id === alertId)).toBe(true);
      expect(response.body.data[0]).toMatchObject({ type: 'STATIONARY', status: 'ACTIVE' });
    });

    it('summarises what needs attention', async () => {
      const response = await as(admin).get('/locations/alerts/summary').expect(200);
      expect(response.body.active).toBeGreaterThanOrEqual(1);
      expect(response.body.needsAttention).toBeGreaterThanOrEqual(1);
    });

    it('lets an administrator acknowledge an alert', async () => {
      const response = await as(admin).post(`/locations/alerts/${alertId}/acknowledge`, { note: 'Driver called, loading delay' }).expect(200);

      expect(response.body).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgeNote: 'Driver called, loading delay' });
      expect(response.body.acknowledgedAt).not.toBeNull();

      const stored = await prisma.fleetLocationAlert.findUniqueOrThrow({ where: { id: alertId } });
      expect(stored.acknowledgedById).toBe(seed.admin.id);
    });

    it('does not resolve an alert merely because it was read', async () => {
      await as(admin).get('/locations/alerts').expect(200);
      await as(admin).get(`/locations/alerts/${alertId}`).expect(200);
      await as(admin).get('/locations/fleet').expect(200);

      expect((await prisma.fleetLocationAlert.findUniqueOrThrow({ where: { id: alertId } })).status).toBe('ACTIVE');
    });

    it('refuses to acknowledge the same alert twice', async () => {
      await as(admin).post(`/locations/alerts/${alertId}/acknowledge`).expect(200);
      await as(admin).post(`/locations/alerts/${alertId}/acknowledge`).expect(400);
    });

    it('lets an administrator resolve an alert by hand', async () => {
      const response = await as(admin).post(`/locations/alerts/${alertId}/resolve`, { reason: 'Scheduled maintenance stop' }).expect(200);

      expect(response.body).toMatchObject({ status: 'RESOLVED', resolvedReason: 'Scheduled maintenance stop' });
      // The state row lets go of a closed alert, so a driver still parked there can raise a new one.
      const state = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(state!.stationaryAlertId).toBeNull();
    });

    it('keeps an acknowledgement when the driver later moves', async () => {
      await as(admin).post(`/locations/alerts/${alertId}/acknowledge`, { note: 'Aware' }).expect(200);

      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...northOf(5_000) })]).expect(200);

      const stored = await prisma.fleetLocationAlert.findUniqueOrThrow({ where: { id: alertId } });
      // Acknowledging is a human act and is not overwritten by the system; the movement is
      // recorded alongside it.
      expect(stored.status).toBe('ACKNOWLEDGED');
      expect(stored.movedAt).not.toBeNull();
    });

    it('records the acknowledgement in the audit trail', async () => {
      await as(admin).post(`/locations/alerts/${alertId}/acknowledge`).expect(200);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'fleet_alert.acknowledged', entityId: alertId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.actorUserId).toBe(seed.admin.id);
    });
  });

  describe('admin live fleet', () => {
    beforeEach(async () => {
      await resetDriver();
      await submit(driver, [fix({ speedKmh: 52, headingDeg: 180 })]).expect(200);
    });

    it('returns real fleet locations with driver and vehicle resolved by the backend', async () => {
      const response = await as(admin).get('/locations/fleet').expect(200);

      const row = response.body.data.find((d: { driverId: string }) => d.driverId === seed.driver.id);
      expect(row).toBeDefined();
      expect(row.position.latitude).toBeCloseTo(DEPOT.latitude, 4);
      expect(row.employee.fullName).toBe('Ramesh Kumar');
      expect(row.vehicle.registrationNumber).toBe(seed.vehicle.registrationNumber);
      expect(row.status).toBe('ACTIVE');
      expect(row.stale).toBe(false);
      expect(row.lastSeenAt).not.toBeNull();
      expect(response.body.summary.total).toBeGreaterThanOrEqual(1);
      // The polling interval is served, not baked into the console bundle.
      expect(typeof response.body.refreshSeconds).toBe('number');
    });

    it('serves one driver\'s detail for the panel', async () => {
      const response = await as(admin).get(`/locations/drivers/${seed.driver.id}`).expect(200);

      expect(response.body).toMatchObject({ driverId: seed.driver.id, status: 'ACTIVE' });
      expect(response.body.position.speedKmh).toBeCloseTo(52, 1);
      expect(response.body.driverCode).toBe(await prisma.driver.findUniqueOrThrow({ where: { id: seed.driver.id } }).then((d) => d.driverCode));
    });

    it('pages one driver\'s history newest first', async () => {
      await submit(driver, [15, 10, 5].map((m) => fix({ capturedAt: minutesAgo(m) }))).expect(200);

      const first = await as(admin).get(`/locations/drivers/${seed.driver.id}/history?limit=2`).expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.page.nextCursor).not.toBeNull();
      expect(new Date(first.body.data[0].capturedAt).getTime()).toBeGreaterThan(new Date(first.body.data[1].capturedAt).getTime());

      const second = await as(admin).get(`/locations/drivers/${seed.driver.id}/history?limit=2&cursor=${first.body.page.nextCursor}`).expect(200);
      expect(second.body.data.length).toBeGreaterThan(0);
      // No overlap between pages.
      const ids = new Set(first.body.data.map((p: { id: string }) => p.id));
      expect(second.body.data.every((p: { id: string }) => !ids.has(p.id))).toBe(true);
    });

    it('filters history by capture time', async () => {
      const response = await as(admin)
        .get(`/locations/drivers/${seed.driver.id}/history?from=${encodeURIComponent(minutesAgo(3))}`)
        .expect(200);
      expect(response.body.data.every((p: { capturedAt: string }) => new Date(p.capturedAt) >= new Date(minutesAgo(3.1)))).toBe(true);
    });

    it('serves recent fixes for a vehicle', async () => {
      const response = await as(admin).get(`/locations/vehicles/${seed.vehicle.id}/history`).expect(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('says plainly when a driver has never reported', async () => {
      await as(admin).get(`/locations/drivers/${seed.otherDriver.id}`).expect(404);
    });

    it('filters the fleet by status and search term', async () => {
      const byStatus = await as(admin).get('/locations/fleet?status=ACTIVE').expect(200);
      expect(byStatus.body.data.every((d: { status: string }) => d.status === 'ACTIVE')).toBe(true);

      const bySearch = await as(admin).get('/locations/fleet?q=Ramesh').expect(200);
      expect(bySearch.body.data.some((d: { driverId: string }) => d.driverId === seed.driver.id)).toBe(true);

      const noMatch = await as(admin).get('/locations/fleet?q=NobodyHere').expect(200);
      expect(noMatch.body.data).toHaveLength(0);
    });

    it('returns empty fleet state with zero summary when no drivers have reported', async () => {
      await resetDriver();
      const response = await as(admin).get('/locations/fleet').expect(200);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.summary).toEqual({
        total: 0,
        active: 0,
        stale: 0,
        offline: 0,
        unavailable: 0,
        alerting: 0,
      });
    });
  });

  describe('recent history agrees with the current location', () => {
    interface Position { id: string; capturedAt: string; latitude: number; longitude: number }
    const history = async (query = ''): Promise<{ data: Position[]; page: { nextCursor: string | null } }> =>
      (await as(admin).get(`/locations/drivers/${seed.driver.id}/history${query}`).expect(200)).body;
    /** What the fleet screen calls current: the position, when it was captured, and the status. */
    const currentRow = async () => {
      const rows = (await as(admin).get('/locations/fleet').expect(200)).body.data as {
        driverId: string;
        status: string;
        capturedAt: string;
        position: { latitude: number; longitude: number };
      }[];
      const row = rows.find((d) => d.driverId === seed.driver.id)!;
      return { status: row.status, capturedAt: row.capturedAt, position: { latitude: row.position.latitude, longitude: row.position.longitude } };
    };
    const capturedMs = (p: { capturedAt: string }) => new Date(p.capturedAt).getTime();

    beforeEach(resetDriver);

    it('starts with the current location even when an older backlog was uploaded after it', async () => {
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...northOf(2_000) })]).expect(200);
      // The phone reconnects and drains what it buffered offline: older captures, uploaded later,
      // so they are stored later and carry the higher ids.
      await submit(driver, [fix({ capturedAt: minutesAgo(90), ...northOf(500) }), fix({ capturedAt: minutesAgo(80), ...northOf(900) })]).expect(200);

      const { data } = await history();
      const current = await currentRow();

      expect(data).toHaveLength(3);
      expect(data[0]).toMatchObject({ capturedAt: current.capturedAt, latitude: current.position.latitude, longitude: current.position.longitude });
      expect(data.map(capturedMs)).toEqual([...data.map(capturedMs)].sort((a, b) => b - a));
    });

    it('keeps the current location on the first page however large the late backlog is', async () => {
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...DEPOT })]).expect(200);
      await submit(driver, [10, 20, 30, 40, 50, 60].map((m) => fix({ capturedAt: minutesAgo(100 + m), ...northOf(m * 100) }))).expect(200);

      const { data } = await history('?limit=3');
      const current = await currentRow();

      // Ordered by insertion, the six backlog rows would fill this page and the live fix would not be on it at all.
      expect(data).toHaveLength(3);
      expect(data[0]).toMatchObject({ capturedAt: current.capturedAt, latitude: current.position.latitude, longitude: current.position.longitude });
    });

    it('leaves the current location and its status alone when a backlog arrives', async () => {
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...northOf(2_000) })]).expect(200);
      const before = await currentRow();

      await submit(driver, [fix({ capturedAt: minutesAgo(90), ...northOf(500) })]).expect(200);

      expect(await currentRow()).toEqual(before);
    });

    it('lists the fix the current location kept first when two fixes share a capture time', async () => {
      const sameInstant = minutesAgo(2);
      await submit(driver, [fix({ capturedAt: sameInstant, ...northOf(100) })]).expect(200);
      // Same instant, stored later: the current location only advances on a strictly newer time, so it keeps the first.
      await submit(driver, [fix({ capturedAt: sameInstant, ...northOf(700) })]).expect(200);

      const { data } = await history();
      const current = await currentRow();

      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ latitude: current.position.latitude, longitude: current.position.longitude });
      expect(Number(data[0]!.id)).toBeLessThan(Number(data[1]!.id));
    });

    it('pages through capture order without gaps or repeats, whatever order the fixes arrived in', async () => {
      // Deliberately shuffled arrival order, one fix per upload, plus two fixes on the same instant.
      for (const minutes of [5, 1, 7, 3, 6, 2, 4]) await submit(driver, [fix({ capturedAt: minutesAgo(minutes), ...northOf(minutes * 50) })]).expect(200);
      const tie = minutesAgo(3.5);
      await submit(driver, [fix({ capturedAt: tie, ...northOf(1_000) })]).expect(200);
      await submit(driver, [fix({ capturedAt: tie, ...northOf(1_100) })]).expect(200);

      const everything = (await history('?limit=50')).data;
      expect(everything).toHaveLength(9);
      everything.forEach((p, i) => {
        if (i === 0) return;
        const previous = everything[i - 1]!;
        expect(capturedMs(previous)).toBeGreaterThanOrEqual(capturedMs(p));
        if (capturedMs(previous) === capturedMs(p)) expect(Number(previous.id)).toBeLessThan(Number(p.id));
      });

      const paged: Position[] = [];
      let cursor: string | null = null;
      do {
        const page = await history(`?limit=4${cursor ? `&cursor=${cursor}` : ''}`);
        paged.push(...page.data);
        cursor = page.page.nextCursor;
      } while (cursor);

      expect(paged.map((p) => p.id)).toEqual(everything.map((p) => p.id));
      expect(new Set(paged.map((p) => p.id)).size).toBe(paged.length);
    });

    it('applies the same order to a vehicle’s history and to the driver’s own', async () => {
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...northOf(2_000) })]).expect(200);
      await submit(driver, [fix({ capturedAt: minutesAgo(90), ...northOf(500) }), fix({ capturedAt: minutesAgo(80), ...northOf(900) })]).expect(200);

      const vehicle = (await as(admin).get(`/locations/vehicles/${seed.vehicle.id}/history`).expect(200)).body.data as Position[];
      const mine = (await as(driver).get('/locations/mine').expect(200)).body.data as Position[];

      for (const list of [vehicle, mine]) {
        expect(list).toHaveLength(3);
        expect(list.map(capturedMs)).toEqual([...list.map(capturedMs)].sort((a, b) => b - a));
      }
    });

    it('still filters by capture time while ordering by it', async () => {
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...DEPOT })]).expect(200);
      await submit(driver, [fix({ capturedAt: minutesAgo(90), ...northOf(500) }), fix({ capturedAt: minutesAgo(80), ...northOf(900) })]).expect(200);

      const { data } = await history(`?from=${encodeURIComponent(minutesAgo(85))}`);

      expect(data).toHaveLength(2);
      expect(capturedMs(data[0]!)).toBeGreaterThan(capturedMs(data[1]!));
    });

    it('refuses a cursor that is not a position in this driver’s history, rather than guessing', async () => {
      await submit(driver, [fix({ capturedAt: minutesAgo(2) })]).expect(200);
      const someoneElses = await prisma.driverLocationPing.create({
        data: { companyId: seed.company.id, driverId: seed.otherDriver.id, latitude: 15.9, longitude: 74.5, recordedAt: new Date(), clientSubmissionId: `foreign-${Date.now()}` },
        select: { id: true },
      });

      await as(admin).get(`/locations/drivers/${seed.driver.id}/history?cursor=${someoneElses.id}`).expect(400);
      await as(admin).get(`/locations/drivers/${seed.driver.id}/history?cursor=999999999999`).expect(400);
    });
  });

  describe('status ages with the clock', () => {
    // The stored row only changes when a phone reports. Letting time pass is simulated by moving
    // its timestamps back, exactly as waiting would have: the stored status is left saying ACTIVE.
    const quietFor = (minutes: number) =>
      prisma.driverLocationState.update({
        where: { driverId: seed.driver.id },
        data: { recordedAt: new Date(minutesAgo(minutes)), lastHeartbeatAt: new Date(minutesAgo(minutes)) },
      });
    const fleet = async (query = '') => (await as(admin).get(`/locations/fleet${query}`).expect(200)).body;
    const mine = (body: { data: { driverId: string }[] }) => body.data.find((d) => d.driverId === seed.driver.id) as { status: string; stale: boolean } | undefined;

    beforeEach(async () => {
      await resetDriver();
      await submit(driver, [fix({ capturedAt: minutesAgo(1), ...DEPOT })]).expect(200);
    });

    it('starts as ACTIVE for a driver who has just reported', async () => {
      expect(mine(await fleet())).toMatchObject({ status: 'ACTIVE', stale: false });
    });

    it('turns to STALE once the newest fix is older than the stale window, with nobody reporting it', async () => {
      await quietFor(20);

      const body = await fleet();
      expect(mine(body)).toMatchObject({ status: 'STALE', stale: true });
      expect(body.summary).toMatchObject({ active: 0, stale: 1, offline: 0 });
    });

    it('turns to OFFLINE once nothing has been heard for the offline window', async () => {
      await quietFor(40);

      const body = await fleet();
      expect(mine(body)).toMatchObject({ status: 'OFFLINE' });
      expect(body.summary).toMatchObject({ active: 0, stale: 0, offline: 1 });
    });

    it('filters by the status the office is shown, not by the one stored at the last report', async () => {
      await quietFor(20);

      expect((await fleet('?status=STALE')).data.map((d: { driverId: string }) => d.driverId)).toEqual([seed.driver.id]);
      expect((await fleet('?status=ACTIVE')).data).toHaveLength(0);
    });

    it('says the same thing on the single-driver detail the panel can ask for', async () => {
      await quietFor(20);
      const response = await as(admin).get(`/locations/drivers/${seed.driver.id}`).expect(200);
      expect(response.body).toMatchObject({ status: 'STALE', stale: true });
    });

    it('leaves the stationary period alone: ageing a status does not touch how long the driver has been parked', async () => {
      const before = (await fleet()).data[0].stationaryMinutes;
      await quietFor(20);
      expect(mine(await fleet())).toMatchObject({ status: 'STALE' });
      // The stationary clock runs from when the stop began, independent of the status shown.
      expect((await fleet()).data[0].stationaryMinutes).toBeGreaterThanOrEqual(before ?? 0);
    });
  });

  describe('tracking state reporting', () => {
    beforeEach(resetDriver);

    it('records the device\'s own tracking state and returns the policy to follow', async () => {
      const response = await as(driver)
        .patch('/drivers/me/location-state', {
          permission: 'GRANTED_ALWAYS',
          locationServicesEnabled: true,
          trackingState: 'TRACKING_ACTIVE',
          pendingUploads: 0,
        })
        .expect(200);

      expect(response.body).toMatchObject({ permission: 'GRANTED_ALWAYS', trackingState: 'TRACKING_ACTIVE' });
      expect(response.body.trackingPolicy).toMatchObject({ movingIntervalSeconds: expect.any(Number), maxBatchSize: expect.any(Number) });
    });

    it('never believes an app that claims to track without permission', async () => {
      const response = await as(driver)
        .patch('/drivers/me/location-state', { permission: 'DENIED', locationServicesEnabled: true, trackingState: 'TRACKING_ACTIVE' })
        .expect(200);

      expect(response.body.trackingState).toBe('LOCATION_PERMISSION_DENIED');
      expect(response.body.status).toBe('PERMISSION_DENIED');
    });

    it('downgrades an active claim to the foreground-only truth', async () => {
      const response = await as(driver)
        .patch('/drivers/me/location-state', { permission: 'GRANTED_FOREGROUND', locationServicesEnabled: true, trackingState: 'TRACKING_ACTIVE' })
        .expect(200);

      expect(response.body.trackingState).toBe('BACKGROUND_PERMISSION_MISSING');
    });

    it('reports a sync backlog to the office', async () => {
      await as(driver)
        .patch('/drivers/me/location-state', {
          permission: 'GRANTED_ALWAYS',
          locationServicesEnabled: true,
          trackingState: 'SYNC_PENDING',
          pendingUploads: 37,
        })
        .expect(200);

      const state = await prisma.driverLocationState.findUnique({ where: { driverId: seed.driver.id } });
      expect(state!.pendingUploads).toBe(37);
      expect(state!.trackingState).toBe('SYNC_PENDING');
    });

    it('serves the tracking policy to the driver app', async () => {
      const response = await as(driver).get('/locations/tracking-policy').expect(200);
      expect(response.body).toMatchObject({
        movingIntervalSeconds: expect.any(Number),
        stationaryIntervalSeconds: expect.any(Number),
        distanceMeters: expect.any(Number),
        bufferLimit: expect.any(Number),
      });
      expect(response.body.stationaryIntervalSeconds).toBeGreaterThan(response.body.movingIntervalSeconds);
    });
  });

  describe('security and RBAC', () => {
    beforeEach(resetDriver);

    it('refuses an unauthenticated submission', async () => {
      await api().post(`${V}/locations`).send({ fixes: [fix()] }).expect(401);
      await api().get(`${V}/locations/fleet`).expect(401);
    });

    it('does not expose fleet-wide location data to a driver', async () => {
      await as(driver).get('/locations/fleet').expect(403);
      await as(driver).get('/locations/alerts').expect(403);
      await as(driver).get(`/locations/drivers/${seed.otherDriver.id}`).expect(403);
      await as(driver).get(`/locations/drivers/${seed.otherDriver.id}/history`).expect(403);
      await as(driver).get(`/locations/vehicles/${seed.vehicle.id}/history`).expect(403);
    });

    it('does not let a driver read even their own record through the office route', async () => {
      // There is exactly one way for a driver to read location data, and it takes no id.
      await as(driver).get(`/locations/drivers/${seed.driver.id}`).expect(403);
    });

    it('lets a driver read only their own history', async () => {
      await submit(driver, [fix()]).expect(200);

      const mine = await as(driver).get('/locations/mine').expect(200);
      expect(mine.body.data.length).toBeGreaterThan(0);

      // Someone else's fix exists in the same company; it must not appear.
      await prisma.driverLocationPing.create({
        data: {
          companyId: seed.company.id,
          driverId: seed.otherDriver.id,
          latitude: 15.4,
          longitude: 75.0,
          recordedAt: new Date(),
          clientSubmissionId: `other-${Date.now()}`,
        },
      });
      const again = await as(driver).get('/locations/mine?limit=500').expect(200);
      const otherPings = await prisma.driverLocationPing.findMany({ where: { driverId: seed.otherDriver.id }, select: { id: true } });
      const otherIds = otherPings.map((p) => p.id.toString());
      expect(again.body.data.every((p: { id: string }) => !otherIds.includes(p.id))).toBe(true);
    });

    it('does not let an office user submit a location', async () => {
      await submit(admin, [fix()]).expect(403);
      await as(admin).get('/locations/mine').expect(403);
      await as(admin).get('/locations/tracking-policy').expect(403);
    });

    it('does not let an accounting user acknowledge a fleet alert', async () => {
      const accountingEmployee = await prisma.employee.create({
        data: { companyId: seed.company.id, employeeCode: `ACC-${Date.now()}`, fullName: 'Accounts Clerk' },
      });
      await prisma.user.create({
        data: {
          companyId: seed.company.id,
          employeeId: accountingEmployee.id,
          email: `acc-${Date.now()}@e2e.test`,
          role: 'ACCOUNTING',
          passwordHash: await new PasswordHasher().hash(fixture.TEST_PASSWORD),
        },
      });
      const accountingToken = await login((await prisma.user.findFirstOrThrow({ where: { employeeId: accountingEmployee.id } })).email as string);

      await submit(driver, [
        fix({ capturedAt: minutesAgo(DURATION_MINUTES + 5), ...DEPOT }),
        fix({ capturedAt: minutesAgo(1), ...northOf(10) }),
      ]).expect(200);
      const alert = await prisma.fleetLocationAlert.findFirstOrThrow({ where: { driverId: seed.driver.id } });

      // Reading the fleet is part of the office's job; acting on an alert is the fleet's.
      await as(accountingToken).get('/locations/fleet').expect(200);
      await as(accountingToken).post(`/locations/alerts/${alert.id}/acknowledge`).expect(403);
    });

    it('does not leak a position into the audit trail', async () => {
      await as(driver)
        .patch('/drivers/me/location-state', { permission: 'GRANTED_ALWAYS', locationServicesEnabled: true, trackingState: 'TRACKING_ACTIVE' })
        .expect(200);
      await submit(driver, [fix()]).expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { companyId: seed.company.id, entityType: { in: ['DriverLocationState', 'FleetLocationAlert'] } },
      });
      const serialised = JSON.stringify(entries);
      // Coordinates are operational data with its own access rules; the audit trail records that
      // something happened, not where.
      expect(serialised).not.toContain('74.498');
      expect(serialised).not.toContain('15.85');
    });
  });

  describe('throughput guards', () => {
    beforeEach(resetDriver);

    it('refuses a batch larger than the configured maximum', async () => {
      const policy = (await as(driver).get('/locations/tracking-policy').expect(200)).body as { maxBatchSize: number };
      const tooMany = Array.from({ length: policy.maxBatchSize + 1 }, (_, i) => fix({ capturedAt: minutesAgo(i + 1) }));

      await submit(driver, tooMany).expect(400);
    });

    it('refuses an empty submission rather than treating it as a heartbeat', async () => {
      await submit(driver, []).expect(400);
    });
  });
});
