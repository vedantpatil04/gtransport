import { PrismaService } from '../../database/prisma.service';
import { LocationConfigService } from './location.config';
import { LocationRetentionService } from './location-retention.service';
import { LocationRetentionScheduler } from './location-retention.scheduler';

interface MockPing {
  id: bigint;
  companyId: string;
  driverId: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
}

interface MockCurrentLocation {
  driverId: string;
  companyId: string;
  recordedAt: Date;
  status: string;
}

describe('LocationRetentionService (GPS Raw History Retention)', () => {
  let service: LocationRetentionService;
  let mockPrisma: any;
  let mockConfig: any;

  let pings: MockPing[];
  let currentLocations: MockCurrentLocation[];
  let alerts: any[];
  let drivers: any[];
  let vehicles: any[];
  let auditLogs: any[];

  const NOW = new Date('2026-10-03T12:00:00.000Z');
  const daysAgo = (days: number, from = NOW) => new Date(from.getTime() - days * 86_400_000);
  const hoursAgo = (hours: number, from = NOW) => new Date(from.getTime() - hours * 3_600_000);

  beforeEach(() => {
    pings = [];
    currentLocations = [];
    alerts = [];
    drivers = [];
    vehicles = [];
    auditLogs = [];

    mockPrisma = {
      driverLocationPing: {
        findMany: jest.fn(async (args: any) => {
          let matching = [...pings];
          if (args?.where?.recordedAt?.lt) {
            const cutoff = args.where.recordedAt.lt;
            matching = matching.filter((p) => p.recordedAt.getTime() < cutoff.getTime());
          }
          if (args?.orderBy?.id === 'asc') {
            matching.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          }
          if (typeof args?.take === 'number') {
            matching = matching.slice(0, args.take);
          }
          if (args?.select?.id) {
            return matching.map((p) => ({ id: p.id }));
          }
          return matching;
        }),
        deleteMany: jest.fn(async (args: any) => {
          const ids = new Set(args?.where?.id?.in ?? []);
          const cutoff = args?.where?.recordedAt?.lt;
          const initialLength = pings.length;
          pings = pings.filter((p) => {
            const idMatches = ids.has(p.id);
            const cutoffMatches = cutoff ? p.recordedAt.getTime() < cutoff.getTime() : true;
            return !(idMatches && cutoffMatches);
          });
          return { count: initialLength - pings.length };
        }),
      },
      driverLocationState: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      fleetLocationAlert: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      driver: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      vehicle: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      employee: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockConfig = {
      rawRetentionDays: 7,
      cleanupIntervalMs: 6 * 3600_000,
      cleanupBatchSize: 1000,
      cleanupEnabled: true,
    };

    service = new LocationRetentionService(mockPrisma as unknown as PrismaService, mockConfig as unknown as LocationConfigService);
  });

  it('record older than 7 days → eligible for cleanup', async () => {
    // 8 days and 10 days ago (both > 7 days old)
    pings.push(
      { id: 101n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(8), latitude: 15.8, longitude: 74.5 },
      { id: 102n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(10), latitude: 15.9, longitude: 74.6 },
    );

    const result = await service.cleanupOldPings({ now: NOW });

    expect(result.deletedCount).toBe(2);
    expect(result.batches).toBe(1);
    expect(pings).toHaveLength(0);
    expect(mockPrisma.driverLocationPing.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [101n, 102n] },
        recordedAt: { lt: result.cutoff },
      },
    });
  });

  it('record exactly within 7 days → retained', async () => {
    // Exactly 7.0 days ago: timestamp equals cutoff, not less than cutoff
    const exactlySevenDays = daysAgo(7);
    pings.push({
      id: 201n,
      companyId: 'c1',
      driverId: 'd1',
      recordedAt: exactlySevenDays,
      latitude: 15.85,
      longitude: 74.5,
    });

    const result = await service.cleanupOldPings({ now: NOW });

    expect(result.deletedCount).toBe(0);
    expect(pings).toHaveLength(1);
    expect(pings[0].id).toBe(201n);
    expect(mockPrisma.driverLocationPing.deleteMany).not.toHaveBeenCalled();
  });

  it('recent record → retained', async () => {
    // Pings recorded 10 minutes ago, 2 hours ago, 1 day ago, 6 days ago
    pings.push(
      { id: 301n, companyId: 'c1', driverId: 'd1', recordedAt: new Date(NOW.getTime() - 10 * 60_000), latitude: 15.85, longitude: 74.5 },
      { id: 302n, companyId: 'c1', driverId: 'd1', recordedAt: hoursAgo(2), latitude: 15.86, longitude: 74.51 },
      { id: 303n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(1), latitude: 15.87, longitude: 74.52 },
      { id: 304n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(6), latitude: 15.88, longitude: 74.53 },
    );

    const result = await service.cleanupOldPings({ now: NOW });

    expect(result.deletedCount).toBe(0);
    expect(pings).toHaveLength(4);
    expect(mockPrisma.driverLocationPing.deleteMany).not.toHaveBeenCalled();
  });

  it('current-location record → never deleted', async () => {
    // Add current-location record (even one with older heartbeat/recordedAt)
    currentLocations.push({
      driverId: 'd1',
      companyId: 'c1',
      recordedAt: daysAgo(14),
      status: 'OFFLINE',
    });

    // Add old raw pings that should be cleaned up
    pings.push({
      id: 401n,
      companyId: 'c1',
      driverId: 'd1',
      recordedAt: daysAgo(9),
      latitude: 15.8,
      longitude: 74.5,
    });

    const result = await service.cleanupOldPings({ now: NOW });

    expect(result.deletedCount).toBe(1);
    expect(mockPrisma.driverLocationState.delete).not.toHaveBeenCalled();
    expect(mockPrisma.driverLocationState.deleteMany).not.toHaveBeenCalled();
    expect(currentLocations).toHaveLength(1);
  });

  it('repeated cleanup → safe/idempotent', async () => {
    pings.push(
      { id: 501n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(12), latitude: 15.8, longitude: 74.5 },
      { id: 502n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(2), latitude: 15.9, longitude: 74.6 },
    );

    // First run deletes the 12-day-old ping
    const firstRun = await service.cleanupOldPings({ now: NOW });
    expect(firstRun.deletedCount).toBe(1);
    expect(pings).toHaveLength(1);
    expect(pings[0].id).toBe(502n);

    // Second run immediately afterwards finds 0 matching pings and deletes 0
    const secondRun = await service.cleanupOldPings({ now: NOW });
    expect(secondRun.deletedCount).toBe(0);
    expect(secondRun.batches).toBe(0);
    expect(pings).toHaveLength(1);
    expect(pings[0].id).toBe(502n);
  });

  it('batch cleanup works', async () => {
    // Seed 7 old pings
    for (let i = 1; i <= 7; i++) {
      pings.push({
        id: BigInt(600 + i),
        companyId: 'c1',
        driverId: 'd1',
        recordedAt: daysAgo(8 + i),
        latitude: 15.8,
        longitude: 74.5,
      });
    }

    // Set batchSize = 3: should take 3 batches (3 + 3 + 1)
    const result = await service.cleanupOldPings({ now: NOW, batchSize: 3 });

    expect(result.deletedCount).toBe(7);
    expect(result.batches).toBe(3);
    expect(pings).toHaveLength(0);
    expect(mockPrisma.driverLocationPing.deleteMany).toHaveBeenCalledTimes(3);
  });

  it('configured value changes behavior correctly', async () => {
    // Ping at 10 days ago and ping at 5 days ago
    pings.push(
      { id: 701n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(10), latitude: 15.8, longitude: 74.5 },
      { id: 702n, companyId: 'c1', driverId: 'd1', recordedAt: daysAgo(5), latitude: 15.85, longitude: 74.55 },
    );

    // When configured to 14 days retention: neither is deleted
    const result14 = await service.cleanupOldPings({ now: NOW, retentionDays: 14 });
    expect(result14.deletedCount).toBe(0);
    expect(pings).toHaveLength(2);

    // When configured to 7 days retention: only the 10-day-old ping is deleted
    const result7 = await service.cleanupOldPings({ now: NOW, retentionDays: 7 });
    expect(result7.deletedCount).toBe(1);
    expect(pings).toHaveLength(1);
    expect(pings[0].id).toBe(702n);

    // When configured to 3 days retention: the 5-day-old ping is also deleted
    const result3 = await service.cleanupOldPings({ now: NOW, retentionDays: 3 });
    expect(result3.deletedCount).toBe(1);
    expect(pings).toHaveLength(0);
  });

  it('unrelated records remain untouched', async () => {
    alerts.push({ id: 'alert-1', companyId: 'c1', driverId: 'd1', triggeredAt: daysAgo(30) });
    drivers.push({ id: 'driver-1', companyId: 'c1' });
    vehicles.push({ id: 'veh-1', companyId: 'c1' });
    auditLogs.push({ id: 'audit-1', companyId: 'c1', occurredAt: daysAgo(30) });

    pings.push({
      id: 801n,
      companyId: 'c1',
      driverId: 'd1',
      recordedAt: daysAgo(20),
      latitude: 15.8,
      longitude: 74.5,
    });

    const result = await service.cleanupOldPings({ now: NOW });
    expect(result.deletedCount).toBe(1);

    expect(mockPrisma.fleetLocationAlert.delete).not.toHaveBeenCalled();
    expect(mockPrisma.fleetLocationAlert.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.driver.delete).not.toHaveBeenCalled();
    expect(mockPrisma.driver.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.vehicle.delete).not.toHaveBeenCalled();
    expect(mockPrisma.vehicle.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.employee.delete).not.toHaveBeenCalled();
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.delete).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

describe('LocationRetentionScheduler', () => {
  let scheduler: LocationRetentionScheduler;
  let mockRetention: any;
  let mockConfig: any;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRetention = {
      cleanupOldPings: jest.fn().mockResolvedValue({
        deletedCount: 5,
        batches: 1,
        cutoff: new Date('2026-09-26T00:00:00.000Z'),
      }),
    };
    mockConfig = {
      rawRetentionDays: 7,
      cleanupIntervalMs: 6 * 3600_000,
      cleanupEnabled: true,
    };
    scheduler = new LocationRetentionScheduler(mockRetention, mockConfig);
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
  });

  it('schedules cleanup on application bootstrap when enabled', async () => {
    scheduler.onApplicationBootstrap();
    expect(mockRetention.cleanupOldPings).not.toHaveBeenCalled();

    // Fast-forward initial delay (60s)
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockRetention.cleanupOldPings).toHaveBeenCalledTimes(1);

    // Fast-forward recurring interval (6h)
    await jest.advanceTimersByTimeAsync(6 * 3600_000);
    expect(mockRetention.cleanupOldPings).toHaveBeenCalledTimes(2);
  });

  it('does not schedule when cleanup is disabled', async () => {
    mockConfig.cleanupEnabled = false;
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockRetention.cleanupOldPings).not.toHaveBeenCalled();
  });

  it('clears timer on module destroy', async () => {
    scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockRetention.cleanupOldPings).not.toHaveBeenCalled();
  });

  it('runOnce executes cleanup directly', async () => {
    const outcome = await scheduler.runOnce({ retentionDays: 7 });
    expect(outcome.deletedCount).toBe(5);
    expect(mockRetention.cleanupOldPings).toHaveBeenCalledWith({ retentionDays: 7 });
  });

  it('catches and logs errors without crashing the tick', async () => {
    mockRetention.cleanupOldPings.mockRejectedValueOnce(new Error('DB connection lost'));
    scheduler.onApplicationBootstrap();

    // Fast-forward to trigger the tick
    await jest.advanceTimersByTimeAsync(60_000);

    // Should reschedule despite the error
    mockRetention.cleanupOldPings.mockResolvedValueOnce({ deletedCount: 0, batches: 0, cutoff: new Date() });
    await jest.advanceTimersByTimeAsync(6 * 3600_000);
    expect(mockRetention.cleanupOldPings).toHaveBeenCalledTimes(2);
  });
});
