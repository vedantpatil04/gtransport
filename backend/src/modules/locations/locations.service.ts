import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DriverStatus, DriverTrackingState, FleetAlertStatus, FleetAlertType, LocationPermission,
  LocationStatus, Prisma, UserRole,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { keysetArgs, toPage, type Page } from '../../common/pagination/pagination';
import { requireDriverScope } from '../auth/access-scope';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type {
  AcknowledgeAlertDto, AlertsQuery, FleetQuery, LocationHistoryQuery, ReportTrackingStateDto,
  ResolveAlertDto, SubmitLocationsDto,
} from './dto/location.dto';
import { isNewerThanCurrent, validateFix, type FixRejection } from './fix-validation';
import { roundCoordinate, type Coordinates } from './geo';
import { LocationIngestThrottle } from './ingest-throttle';
import { LocationConfigService } from './location.config';
import { deriveLocationStatus, reconcileTrackingState } from './location-status.policy';
import {
  ALERT_VIEW, FLEET_LOCATION_VIEW, PING_VIEW, presentAlert, presentFleetLocation, presentPing,
  type AlertRow, type FleetLocationRow, type PingRow,
} from './location.presenter';
import {
  durationMinutes, evaluateStationary, EMPTY_STATIONARY_STATE, NO_KNOWN_LOCATIONS,
  type KnownLocationResolver, type StationaryState,
} from './stationary-engine';

/** What happened to one submitted fix. Reported back per fix so a device can stop retrying. */
export interface FixResult {
  clientSubmissionId: string;
  outcome: 'stored' | 'duplicate' | 'rejected';
  /** Present on 'rejected'. The device must not retry these: they will never be accepted. */
  reason?: FixRejection;
  message?: string;
}

export interface IngestResult {
  stored: number;
  duplicates: number;
  rejected: number;
  results: FixResult[];
  /** The current state after the batch, so the app can show the truth without a second call. */
  state: { status: LocationStatus; trackingState: DriverTrackingState; lastSeenAt: string | null };
  alertRaised: boolean;
}

interface NormalisedFix {
  clientSubmissionId: string;
  position: Coordinates;
  recordedAt: Date;
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  altitudeMeters: number | null;
  batteryPct: number | null;
  provider: string | null;
}

const decimal = (value: number | null): Prisma.Decimal | null => (value === null ? null : new Prisma.Decimal(value));

/**
 * Fleet location intelligence.
 *
 * The shape of the work, and why it is shaped this way:
 *
 *  - **Identity is never taken from the request.** The driver comes from the bearer token; the
 *    vehicle comes from that driver's one open assignment. A device cannot submit a position for
 *    another driver, or attach its own position to a truck it is not driving, because neither
 *    field exists on the wire.
 *  - **Two tables, two jobs.** Every accepted fix is appended to history and kept. Separately,
 *    one row per driver holds the current position, and that row only ever moves forward in
 *    time — so a fix that was buffered offline and arrives after a newer one is recorded in
 *    history without dragging the driver's marker backwards on the map.
 *  - **Stationary detection happens here, at ingestion.** The admin screen reads a decision
 *    that has already been made; it never recomputes four hours of history per refresh.
 *  - **Retries are free.** A fix carries a device-generated id with a unique constraint behind
 *    it, so re-uploading a buffered queue after a flaky connection cannot double-count anything.
 */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: LocationConfigService,
    private readonly throttle: LocationIngestThrottle,
  ) {}

  /**
   * Geofence suppression hook. Phase 6 configures no known locations; the stationary engine
   * takes the resolver as an argument so office/workshop/yard suppression can be added later
   * without touching the detection rule itself.
   */
  private readonly knownLocations: KnownLocationResolver = NO_KNOWN_LOCATIONS;

  // ───────────────────────────── Driver: ingestion ─────────────────────────────

  /**
   * Accepts a batch of fixes from the signed-in driver.
   *
   * Every fix is judged on its own: one bad reading does not lose the rest of a queue that took
   * an hour of poor signal to accumulate. Per-fix outcomes come back so the device can drop what
   * was stored or permanently refused and keep only what is worth retrying.
   */
  async ingest(user: AuthenticatedUser, dto: SubmitLocationsDto): Promise<IngestResult> {
    const { driverId } = requireDriverScope(user);
    const limits = this.config.limits;
    const strategy = this.config.trackingStrategy;

    if (dto.fixes.length > strategy.maxBatchSize) {
      throw new BadRequestException(`At most ${strategy.maxBatchSize} fixes may be submitted at once.`);
    }

    const decision = this.throttle.check(driverId, dto.fixes.length, limits.maxFixesPerMinute);
    if (!decision.allowed) {
      // 429 would be the textbook answer, but the shared error envelope has no code for it and
      // the client treats 4xx alike; the message says what to do, and the retry stays safe.
      this.logger.warn(`Location ingestion throttled for driver ${driverId}: ${dto.fixes.length} fixes, retry in ${decision.retryAfterSeconds}s`);
      throw new BadRequestException(`Too many location updates. Retry in ${decision.retryAfterSeconds} seconds.`);
    }

    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, companyId: user.companyId, deletedAt: null },
      select: {
        id: true,
        status: true,
        locationSharingEnabled: true,
        currentAssignment: { select: { vehicleId: true } },
      },
    });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    // A driver who has been stood down is no longer on the road; their device may still be
    // draining a queue from before, so this is refused clearly rather than silently dropped.
    if (driver.status !== DriverStatus.ACTIVE) {
      throw new ForbiddenException(`Your driver profile is ${driver.status.toLowerCase().replace('_', ' ')}, so location updates are not accepted.`);
    }

    const now = new Date();
    const vehicleId = driver.currentAssignment?.vehicleId ?? null;

    const results: FixResult[] = [];
    const accepted: NormalisedFix[] = [];

    for (const raw of dto.fixes) {
      const fix: NormalisedFix = {
        clientSubmissionId: raw.clientSubmissionId.trim(),
        position: { latitude: roundCoordinate(raw.latitude), longitude: roundCoordinate(raw.longitude) },
        recordedAt: new Date(raw.capturedAt),
        accuracyMeters: raw.accuracyMeters ?? null,
        speedKmh: raw.speedKmh ?? null,
        headingDeg: raw.headingDeg ?? null,
        altitudeMeters: raw.altitudeMeters ?? null,
        batteryPct: raw.batteryPct ?? null,
        provider: raw.provider?.trim() || null,
      };

      if (!fix.clientSubmissionId) {
        results.push({ clientSubmissionId: raw.clientSubmissionId, outcome: 'rejected', reason: 'timestamp', message: 'A submission id is required.' });
        continue;
      }

      const validation = validateFix(fix, limits, now);
      if (!validation.ok) {
        results.push({ clientSubmissionId: fix.clientSubmissionId, outcome: 'rejected', reason: validation.reason, message: validation.message });
        continue;
      }
      accepted.push(fix);
    }

    // Oldest first, so the stationary engine sees the driver's day in the order it happened
    // even when a device uploads its buffer out of order.
    accepted.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

    const stored = await this.storeFixes(user.companyId, driverId, vehicleId, accepted, results);

    const reportedTracking = dto.trackingState ?? null;
    const outcome = await this.advanceCurrentState({
      companyId: user.companyId,
      driverId,
      vehicleId,
      fixes: stored,
      now,
      reportedTracking,
      pendingUploads: dto.pendingUploads ?? 0,
    });

    if (results.some((r) => r.outcome === 'rejected')) {
      // Counts and reasons only. A rejected fix's coordinates are never logged.
      const reasons = results.filter((r) => r.outcome === 'rejected').map((r) => r.reason);
      this.logger.warn(`Rejected ${reasons.length} of ${dto.fixes.length} fixes for driver ${driverId}: ${[...new Set(reasons)].join(', ')}`);
    }

    return {
      stored: stored.length,
      duplicates: results.filter((r) => r.outcome === 'duplicate').length,
      rejected: results.filter((r) => r.outcome === 'rejected').length,
      results,
      state: {
        status: outcome.status,
        trackingState: outcome.trackingState,
        lastSeenAt: outcome.lastSeenAt?.toISOString() ?? null,
      },
      alertRaised: outcome.alertRaised,
    };
  }

  /**
   * Appends validated fixes to history, one insert each so a duplicate cannot take the batch
   * down with it. The unique key on (company, submission id) is the authority — a pre-flight
   * lookup would still race two simultaneous retries, whereas the constraint cannot.
   */
  private async storeFixes(
    companyId: string,
    driverId: string,
    vehicleId: string | null,
    fixes: NormalisedFix[],
    results: FixResult[],
  ): Promise<NormalisedFix[]> {
    const stored: NormalisedFix[] = [];

    for (const fix of fixes) {
      try {
        await this.prisma.driverLocationPing.create({
          data: {
            companyId,
            driverId,
            vehicleId,
            latitude: new Prisma.Decimal(fix.position.latitude),
            longitude: new Prisma.Decimal(fix.position.longitude),
            accuracyMeters: decimal(fix.accuracyMeters),
            speedKmh: decimal(fix.speedKmh),
            headingDeg: decimal(fix.headingDeg),
            altitudeMeters: decimal(fix.altitudeMeters),
            batteryPct: fix.batteryPct,
            provider: fix.provider,
            recordedAt: fix.recordedAt,
            clientSubmissionId: fix.clientSubmissionId,
          },
          select: { id: true },
        });
        stored.push(fix);
        results.push({ clientSubmissionId: fix.clientSubmissionId, outcome: 'stored' });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          // Already here: the device is retrying a fix that did reach us. Not an error.
          results.push({ clientSubmissionId: fix.clientSubmissionId, outcome: 'duplicate' });
          continue;
        }
        throw error;
      }
    }

    return stored;
  }

  /**
   * Brings the current-location row into line with the newly stored fixes, and runs stationary
   * detection over them in order.
   *
   * All of it inside one transaction, with the state row locked: two uploads from the same
   * driver arriving together (a retry racing the live tracker) must not interleave and produce
   * two alerts for the same stop, or leave the anchor pointing at the wrong place.
   */
  private async advanceCurrentState(input: {
    companyId: string;
    driverId: string;
    vehicleId: string | null;
    fixes: NormalisedFix[];
    now: Date;
    reportedTracking: DriverTrackingState | null;
    pendingUploads: number;
  }): Promise<{ status: LocationStatus; trackingState: DriverTrackingState; lastSeenAt: Date | null; alertRaised: boolean }> {
    const policy = this.config.stationary;
    const staleness = this.config.staleness;

    const raised = await this.prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the one row this driver owns. Serialises concurrent uploads for
      // this driver only; other drivers are untouched.
      const locked = await tx.$queryRaw<
        {
          permission: LocationPermission;
          location_services_enabled: boolean;
          tracking_state: DriverTrackingState;
          recorded_at: Date | null;
          last_heartbeat_at: Date | null;
          stationary_anchor_lat: Prisma.Decimal | null;
          stationary_anchor_lng: Prisma.Decimal | null;
          stationary_since: Date | null;
          stationary_alert_id: string | null;
        }[]
      >`SELECT permission, location_services_enabled, tracking_state, recorded_at, last_heartbeat_at,
               stationary_anchor_lat, stationary_anchor_lng, stationary_since, stationary_alert_id
          FROM driver_location_states
         WHERE driver_id = ${input.driverId}::uuid
           FOR UPDATE`;

      const existing = locked[0] ?? null;

      let stationary: StationaryState = existing
        ? {
            anchor:
              existing.stationary_anchor_lat !== null && existing.stationary_anchor_lng !== null
                ? { latitude: existing.stationary_anchor_lat.toNumber(), longitude: existing.stationary_anchor_lng.toNumber() }
                : null,
            since: existing.stationary_since,
            alertId: existing.stationary_alert_id,
          }
        : EMPTY_STATIONARY_STATE;

      let newestAccepted: NormalisedFix | null = null;
      let currentRecordedAt = existing?.recorded_at ?? null;
      let alertRaised = false;

      for (const fix of input.fixes) {
        // Stationary detection follows the driver's real timeline, so it runs on every stored
        // fix — including one that arrived late — while the marker below only moves forward.
        const evaluation = evaluateStationary(stationary, fix, policy, this.knownLocations);

        switch (evaluation.kind) {
          case 'ignored':
            break;

          case 'started': {
            stationary = evaluation.state;
            // Real movement closes an open alert but never erases it: the office still needs to
            // see that a four-hour stop happened, and when it ended.
            if (evaluation.clearedAlertId) {
              await tx.fleetLocationAlert.updateMany({
                where: { id: evaluation.clearedAlertId, movedAt: null },
                data: {
                  movedAt: fix.recordedAt,
                  // An acknowledged alert stays acknowledged; only an untouched one auto-closes.
                  ...(await this.movementClosure(tx, evaluation.clearedAlertId, fix.recordedAt)),
                },
              });
            }
            break;
          }

          case 'threshold-reached': {
            if (evaluation.suppressedBy) {
              // A known place (office, workshop, customer yard): the timer keeps running so the
              // office can see the stop, but no alert is raised for an expected one.
              stationary = { ...evaluation.state, alertId: null };
              break;
            }
            const alert = await tx.fleetLocationAlert.create({
              data: {
                companyId: input.companyId,
                driverId: input.driverId,
                vehicleId: input.vehicleId,
                type: FleetAlertType.STATIONARY,
                status: FleetAlertStatus.ACTIVE,
                triggeredAt: fix.recordedAt,
                stationarySince: evaluation.since,
                latitude: new Prisma.Decimal(stationary.anchor?.latitude ?? fix.position.latitude),
                longitude: new Prisma.Decimal(stationary.anchor?.longitude ?? fix.position.longitude),
                durationMinutes: durationMinutes(evaluation.heldForMs),
                radiusMeters: policy.radiusMeters,
              },
              select: { id: true },
            });
            // Recording the alert id on the state is what makes this idempotent for the rest of
            // the period: every later fix in the same stop sees 'already-alerted'.
            stationary = { ...evaluation.state, alertId: alert.id };
            alertRaised = true;
            this.logger.log(
              `Stationary alert ${alert.id} raised for driver ${input.driverId} after ${durationMinutes(evaluation.heldForMs)} minutes within ${policy.radiusMeters} m`,
            );
            break;
          }

          case 'holding':
          case 'already-alerted':
            stationary = evaluation.state;
            break;
        }

        if (isNewerThanCurrent(fix.recordedAt, currentRecordedAt)) {
          newestAccepted = fix;
          currentRecordedAt = fix.recordedAt;
        }
      }

      // A fix that actually arrived is proof the operating system allowed a location read. When
      // that contradicts what was recorded earlier — permission never reported, or a denial the
      // driver has since reversed — the fix is the newer evidence and wins. Only the minimum is
      // inferred: producing a position proves foreground permission, and says nothing about
      // background permission, which the app reports for itself. So a device that has only ever
      // sent fixes shows as BACKGROUND_PERMISSION_MISSING until it says otherwise, rather than
      // being credited with a permission nobody has confirmed.
      const hadFixes = input.fixes.length > 0;
      const storedPermission = existing?.permission ?? LocationPermission.UNKNOWN;
      const permission =
        hadFixes && (storedPermission === LocationPermission.UNKNOWN || storedPermission === LocationPermission.DENIED)
          ? LocationPermission.GRANTED_FOREGROUND
          : storedPermission;
      const servicesEnabled = hadFixes ? true : (existing?.location_services_enabled ?? false);

      // The claim is still reconciled against permissions, so foreground-only can never pass
      // itself off as full background tracking.
      const claimed =
        input.reportedTracking ??
        (input.pendingUploads > 0
          ? DriverTrackingState.SYNC_PENDING
          : hadFixes
            ? DriverTrackingState.TRACKING_ACTIVE
            : (existing?.tracking_state ?? DriverTrackingState.TRACKING_UNAVAILABLE));
      const trackingState = reconcileTrackingState(claimed, permission, servicesEnabled);

      const lastSeenAt = input.now;
      const status = deriveLocationStatus(
        { permission, locationServicesEnabled: servicesEnabled, lastHeartbeatAt: lastSeenAt, recordedAt: currentRecordedAt, trackingState },
        input.now,
        staleness,
      );

      const position = newestAccepted
        ? {
            latitude: new Prisma.Decimal(newestAccepted.position.latitude),
            longitude: new Prisma.Decimal(newestAccepted.position.longitude),
            accuracyMeters: decimal(newestAccepted.accuracyMeters),
            speedKmh: decimal(newestAccepted.speedKmh),
            headingDeg: decimal(newestAccepted.headingDeg),
            altitudeMeters: decimal(newestAccepted.altitudeMeters),
            batteryPct: newestAccepted.batteryPct,
            recordedAt: newestAccepted.recordedAt,
            receivedAt: input.now,
            vehicleId: input.vehicleId,
          }
        : {};

      const stationaryColumns = {
        stationaryAnchorLat: stationary.anchor ? new Prisma.Decimal(stationary.anchor.latitude) : null,
        stationaryAnchorLng: stationary.anchor ? new Prisma.Decimal(stationary.anchor.longitude) : null,
        stationarySince: stationary.since,
        stationaryAlertId: stationary.alertId,
      };

      await tx.driverLocationState.upsert({
        where: { driverId: input.driverId },
        create: {
          driverId: input.driverId,
          companyId: input.companyId,
          permission,
          locationServicesEnabled: servicesEnabled,
          trackingState,
          status,
          pendingUploads: input.pendingUploads,
          lastHeartbeatAt: lastSeenAt,
          ...position,
          ...stationaryColumns,
        },
        update: {
          trackingState,
          status,
          permission,
          pendingUploads: input.pendingUploads,
          lastHeartbeatAt: lastSeenAt,
          locationServicesEnabled: servicesEnabled,
          ...position,
          ...stationaryColumns,
        },
      });

      return { status, trackingState, lastSeenAt, alertRaised };
    });

    return raised;
  }

  /**
   * How an open alert closes when the driver moves. An alert the office has already
   * acknowledged keeps that status — the acknowledgement is a human act and is not overwritten;
   * an untouched one is resolved, because the condition it described has genuinely ended.
   */
  private async movementClosure(
    tx: Prisma.TransactionClient,
    alertId: string,
    movedAt: Date,
  ): Promise<Partial<Prisma.FleetLocationAlertUpdateManyMutationInput>> {
    const alert = await tx.fleetLocationAlert.findUnique({ where: { id: alertId }, select: { status: true } });
    if (alert?.status !== FleetAlertStatus.ACTIVE) return {};
    return { status: FleetAlertStatus.RESOLVED, resolvedAt: movedAt, resolvedReason: 'movement' };
  }

  // ───────────────────────────── Driver: tracking state ─────────────────────────────

  /**
   * Records what the driver's phone reports about its own tracking. Carries no coordinates: a
   * status report is not a position, and the app must not be able to assert that tracking is
   * working when the operating system says otherwise.
   */
  async reportTrackingState(user: AuthenticatedUser, dto: ReportTrackingStateDto) {
    const { driverId } = requireDriverScope(user);
    const now = new Date();

    const existing = await this.prisma.driverLocationState.findUnique({
      where: { driverId },
      select: { recordedAt: true, trackingState: true, permission: true },
    });

    const claimed = dto.trackingState ?? this.inferTrackingState(dto);
    const trackingState = reconcileTrackingState(claimed, dto.permission, dto.locationServicesEnabled);
    const status = deriveLocationStatus(
      {
        permission: dto.permission,
        locationServicesEnabled: dto.locationServicesEnabled,
        lastHeartbeatAt: now,
        recordedAt: existing?.recordedAt ?? null,
        trackingState,
      },
      now,
      this.config.staleness,
    );

    const saved = await this.prisma.driverLocationState.upsert({
      where: { driverId },
      create: {
        driverId,
        companyId: user.companyId,
        permission: dto.permission,
        locationServicesEnabled: dto.locationServicesEnabled,
        trackingState,
        status,
        pendingUploads: dto.pendingUploads ?? 0,
        lastHeartbeatAt: now,
      },
      update: {
        permission: dto.permission,
        locationServicesEnabled: dto.locationServicesEnabled,
        trackingState,
        status,
        ...(dto.pendingUploads === undefined ? {} : { pendingUploads: dto.pendingUploads }),
        lastHeartbeatAt: now,
      },
      select: { status: true, permission: true, trackingState: true, pendingUploads: true },
    });

    // Permission and tracking changes are worth an audit line; a routine heartbeat is not, or the
    // audit table would grow as fast as the ping table.
    if (existing?.trackingState !== trackingState || existing?.permission !== dto.permission) {
      await this.audit.record({
        action: 'driver.location_tracking_reported',
        entityType: 'DriverLocationState',
        entityId: driverId,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: {
          permission: dto.permission,
          locationServicesEnabled: dto.locationServicesEnabled,
          trackingState,
          status: saved.status,
          ...(existing ? { from: existing.trackingState } : {}),
        },
      });
    }

    return { ...saved, trackingPolicy: this.trackingPolicy() };
  }

  /** The strategy the device should follow. Served, not hardcoded, so it is tunable per deployment. */
  trackingPolicy() {
    const strategy = this.config.trackingStrategy;
    return {
      movingIntervalSeconds: strategy.movingIntervalSeconds,
      stationaryIntervalSeconds: strategy.stationaryIntervalSeconds,
      distanceMeters: strategy.distanceMeters,
      bufferLimit: strategy.bufferLimit,
      maxBatchSize: strategy.maxBatchSize,
      staleAfterMinutes: this.config.staleness.staleAfterMs / 60_000,
    };
  }

  /** Falls back to the state the reported permissions imply, for a client that names none. */
  private inferTrackingState(dto: ReportTrackingStateDto): DriverTrackingState {
    if (!dto.locationServicesEnabled) return DriverTrackingState.LOCATION_SERVICES_DISABLED;
    if (dto.permission === LocationPermission.DENIED) return DriverTrackingState.LOCATION_PERMISSION_DENIED;
    if (dto.permission === LocationPermission.UNKNOWN) return DriverTrackingState.TRACKING_UNAVAILABLE;
    if (dto.permission === LocationPermission.GRANTED_FOREGROUND) return DriverTrackingState.BACKGROUND_PERMISSION_MISSING;
    if (dto.pendingUploads && dto.pendingUploads > 0) return DriverTrackingState.SYNC_PENDING;
    return DriverTrackingState.TRACKING_ACTIVE;
  }

  /** A driver's own recent fixes. Scoped to the session; there is no driver id on the route. */
  async myHistory(user: AuthenticatedUser, query: LocationHistoryQuery) {
    const { driverId } = requireDriverScope(user);
    return this.history(user.companyId, driverId, query);
  }

  // ───────────────────────────── Office: fleet views ─────────────────────────────

  /**
   * Every driver's current location in one query.
   *
   * One indexed read of at most one row per driver, with the driver, employee and vehicle joined
   * in — no request per marker, no N+1, and no contact with the history table however many years
   * of fixes it holds.
   */
  async fleet(companyId: string, viewerRole: UserRole, query: FleetQuery) {
    const now = new Date();
    const q = query.q?.trim();

    const where: Prisma.DriverLocationStateWhereInput = {
      companyId,
      driver: {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { driverCode: { contains: q, mode: Prisma.QueryMode.insensitive } },
                { employee: { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
                { employee: { phone: { contains: q, mode: Prisma.QueryMode.insensitive } } },
                { currentAssignment: { vehicle: { registrationNumber: { contains: q, mode: Prisma.QueryMode.insensitive } } } },
              ],
            }
          : {}),
      },
      ...(query.status ? { status: query.status } : {}),
      ...(query.trackingState ? { trackingState: query.trackingState } : {}),
      ...(query.alerting === 1 ? { stationaryAlert: { status: FleetAlertStatus.ACTIVE } } : {}),
    };

    const rows = await this.prisma.driverLocationState.findMany({
      where,
      select: FLEET_LOCATION_VIEW,
      orderBy: [{ lastHeartbeatAt: 'desc' }, { driverId: 'asc' }],
    });

    const staleAfterMs = this.config.staleness.staleAfterMs;
    const data = rows.map((row) => presentFleetLocation(row, now, staleAfterMs));

    return {
      data,
      summary: {
        total: data.length,
        active: data.filter((d) => d.status === LocationStatus.ACTIVE).length,
        stale: data.filter((d) => d.status === LocationStatus.STALE).length,
        offline: data.filter((d) => d.status === LocationStatus.OFFLINE).length,
        unavailable: data.filter((d) => d.status === LocationStatus.PERMISSION_DENIED || d.status === LocationStatus.LOCATION_DISABLED).length,
        alerting: data.filter((d) => d.alert?.status === FleetAlertStatus.ACTIVE).length,
      },
      /** So the console polls at the configured rate rather than one baked into the bundle. */
      refreshSeconds: this.config.fleetRefreshSeconds,
      viewerRole,
      serverTime: now.toISOString(),
    };
  }

  /** One driver's current location, for the detail panel. */
  async driverLocation(companyId: string, driverId: string) {
    const row = await this.prisma.driverLocationState.findFirst({
      where: { driverId, companyId, driver: { deletedAt: null } },
      select: FLEET_LOCATION_VIEW,
    });
    if (!row) {
      // Either no such driver, or one that has never reported. Tell them apart, because the
      // second is normal for a newly created driver and needs no investigation.
      const driver = await this.prisma.driver.findFirst({ where: { id: driverId, companyId, deletedAt: null }, select: { id: true } });
      if (!driver) throw new NotFoundException('Driver not found.');
      throw new NotFoundException('This driver has not reported a location yet.');
    }
    return presentFleetLocation(row as FleetLocationRow, new Date(), this.config.staleness.staleAfterMs);
  }

  /**
   * One driver's location history, newest first, paged on the ping id.
   *
   * Always bounded and always indexed: the caller gets a page, never "all of it", so this cannot
   * become the query that loads years of fixes into memory.
   */
  async history(companyId: string, driverId: string, query: LocationHistoryQuery) {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, companyId, deletedAt: null }, select: { id: true } });
    if (!driver) throw new NotFoundException('Driver not found.');

    const recordedAt = this.rangeFilter(query.from, query.to);
    const cursor = query.cursor ? BigInt(query.cursor) : null;

    const rows = await this.prisma.driverLocationPing.findMany({
      where: {
        companyId,
        driverId,
        ...(recordedAt ? { recordedAt } : {}),
        ...(cursor === null ? {} : { id: { lt: cursor } }),
      },
      select: PING_VIEW,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = (hasMore ? rows.slice(0, query.limit) : rows) as PingRow[];
    return {
      data: page.map(presentPing),
      page: { limit: query.limit, nextCursor: hasMore ? (page[page.length - 1]?.id.toString() ?? null) : null },
    };
  }

  /** Recent fixes for one vehicle, whoever was driving it at the time. */
  async vehicleHistory(companyId: string, vehicleId: string, query: LocationHistoryQuery) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId, deletedAt: null }, select: { id: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');

    const recordedAt = this.rangeFilter(query.from, query.to);
    const cursor = query.cursor ? BigInt(query.cursor) : null;

    const rows = await this.prisma.driverLocationPing.findMany({
      where: { companyId, vehicleId, ...(recordedAt ? { recordedAt } : {}), ...(cursor === null ? {} : { id: { lt: cursor } }) },
      select: PING_VIEW,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = (hasMore ? rows.slice(0, query.limit) : rows) as PingRow[];
    return {
      data: page.map(presentPing),
      page: { limit: query.limit, nextCursor: hasMore ? (page[page.length - 1]?.id.toString() ?? null) : null },
    };
  }

  private rangeFilter(from?: string, to?: string): Prisma.DateTimeFilter | null {
    if (!from && !to) return null;
    const filter: Prisma.DateTimeFilter = {};
    if (from) {
      const value = new Date(from);
      if (Number.isNaN(value.getTime())) throw new BadRequestException('"from" is not a valid date.');
      filter.gte = value;
    }
    if (to) {
      const value = new Date(to);
      if (Number.isNaN(value.getTime())) throw new BadRequestException('"to" is not a valid date.');
      filter.lte = value;
    }
    if (filter.gte && filter.lte && (filter.gte as Date) > (filter.lte as Date)) {
      throw new BadRequestException('"from" must not be after "to".');
    }
    return filter;
  }

  // ───────────────────────────── Office: alerts ─────────────────────────────

  async alerts(companyId: string, viewerRole: UserRole, query: AlertsQuery): Promise<Page<ReturnType<typeof presentAlert>>> {
    const rows = await this.prisma.fleetLocationAlert.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.driverId ? { driverId: query.driverId } : {}),
      },
      select: ALERT_VIEW,
      ...keysetArgs(query),
    });

    const page = toPage(rows as (AlertRow & { id: string })[], query.limit);
    return { ...page, data: page.data.map((row) => presentAlert(row, viewerRole)) };
  }

  /** Counts for the navigation badge: unacknowledged alerts are the ones needing attention. */
  async alertSummary(companyId: string) {
    const [active, acknowledged] = await Promise.all([
      this.prisma.fleetLocationAlert.count({ where: { companyId, status: FleetAlertStatus.ACTIVE } }),
      this.prisma.fleetLocationAlert.count({ where: { companyId, status: FleetAlertStatus.ACKNOWLEDGED } }),
    ]);
    return { active, acknowledged, needsAttention: active };
  }

  async findAlert(companyId: string, id: string, viewerRole: UserRole) {
    const row = await this.prisma.fleetLocationAlert.findFirst({ where: { id, companyId }, select: ALERT_VIEW });
    if (!row) throw new NotFoundException('Alert not found.');
    return presentAlert(row as AlertRow, viewerRole);
  }

  /**
   * Acknowledges an alert: the office has seen it and is dealing with it. Deliberately not the
   * same as resolving it — acknowledging says "noted", resolving says "over" — and displaying an
   * alert does neither.
   */
  async acknowledgeAlert(user: AuthenticatedUser, id: string, dto: AcknowledgeAlertDto) {
    const existing = await this.prisma.fleetLocationAlert.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundException('Alert not found.');
    if (existing.status === FleetAlertStatus.ACKNOWLEDGED) throw new BadRequestException('This alert has already been acknowledged.');
    if (existing.status === FleetAlertStatus.RESOLVED) throw new BadRequestException('This alert is already resolved.');

    const now = new Date();
    await this.prisma.fleetLocationAlert.update({
      where: { id },
      data: { status: FleetAlertStatus.ACKNOWLEDGED, acknowledgedAt: now, acknowledgedById: user.id, acknowledgeNote: dto.note?.trim() || null },
    });

    await this.audit.record({
      action: 'fleet_alert.acknowledged',
      entityType: 'FleetLocationAlert',
      entityId: id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: existing.status, to: FleetAlertStatus.ACKNOWLEDGED },
      metadata: dto.note ? { note: dto.note.trim() } : undefined,
    });

    return this.findAlert(user.companyId, id, user.role);
  }

  /** Closes an alert by hand, for a stop the office has looked into and settled. */
  async resolveAlert(user: AuthenticatedUser, id: string, dto: ResolveAlertDto) {
    const existing = await this.prisma.fleetLocationAlert.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundException('Alert not found.');
    if (existing.status === FleetAlertStatus.RESOLVED) throw new BadRequestException('This alert is already resolved.');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.fleetLocationAlert.update({
        where: { id },
        data: { status: FleetAlertStatus.RESOLVED, resolvedAt: now, resolvedById: user.id, resolvedReason: dto.reason?.trim() || 'manual' },
      });
      // The state row stops pointing at a closed alert, so a driver who is still parked there
      // can raise a fresh one rather than being permanently silenced by the resolved record.
      await tx.driverLocationState.updateMany({ where: { stationaryAlertId: id }, data: { stationaryAlertId: null } });
    });

    await this.audit.record({
      action: 'fleet_alert.resolved',
      entityType: 'FleetLocationAlert',
      entityId: id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: existing.status, to: FleetAlertStatus.RESOLVED },
      metadata: dto.reason ? { reason: dto.reason.trim() } : undefined,
    });

    return this.findAlert(user.companyId, id, user.role);
  }
}
