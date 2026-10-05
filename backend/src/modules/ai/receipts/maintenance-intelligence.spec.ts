import { Prisma } from '@prisma/client';
import { analyseVehicle } from './maintenance-intelligence.service';

/**
 * Maintenance intelligence is arithmetic over verified service records. These tests pin down what
 * may be said — due, overdue, repeated, frequent — and that nothing is said without a basis.
 */

const VEHICLE = { id: 'veh-1', registrationNumber: 'KA 22 AB 1234' };
const NOW = new Date('2026-06-15T06:00:00.000Z');

let seq = 0;
function service(date: string, overrides: Partial<{
  serviceType: string | null; nextServiceDate: string | null; nextServiceKm: number | null; odometerKm: number | null;
  vendorName: string | null; lines: { description: string; kind: string | null }[]; amount: string;
}> = {}) {
  seq += 1;
  return {
    id: `svc-${seq}`,
    vehicleId: VEHICLE.id,
    amount: new Prisma.Decimal(overrides.amount ?? '2500.00'),
    expenseDate: new Date(`${date}T00:00:00.000Z`),
    vendorName: overrides.vendorName ?? 'Sharma Auto Works',
    serviceType: overrides.serviceType ?? null,
    invoiceNumber: null,
    odometerKm: overrides.odometerKm ?? null,
    nextServiceDate: overrides.nextServiceDate ? new Date(`${overrides.nextServiceDate}T00:00:00.000Z`) : null,
    nextServiceKm: overrides.nextServiceKm ?? null,
    serviceLineItems: (overrides.lines ?? []) as unknown as Prisma.JsonValue,
    vehicle: VEHICLE,
  };
}

describe('analyseVehicle', () => {
  it('says nothing, and says why, when there is no verified history', () => {
    const result = analyseVehicle(VEHICLE.id, [], NOW);
    expect(result.verifiedServices).toBe(0);
    expect(result.nextService).toBeNull();
    expect(result.observations).toEqual([]);
    expect(result.basis).toContain('No verified service records');
  });

  it('reports an overdue service from the date the workshop printed', () => {
    const result = analyseVehicle(VEHICLE.id, [service('2026-03-01', { nextServiceDate: '2026-06-01', odometerKm: 48_000, nextServiceKm: 58_000 })], NOW);
    expect(result.nextService).toMatchObject({ source: 'workshop', status: 'overdue', dueDate: '2026-06-01', daysRemaining: -14, dueKm: 58_000 });
    expect(result.observations[0]).toMatchObject({ kind: 'service_due', severity: 'attention' });
  });

  it('reports an upcoming service within the next month', () => {
    const result = analyseVehicle(VEHICLE.id, [service('2026-04-01', { nextServiceDate: '2026-07-01' })], NOW);
    expect(result.nextService).toMatchObject({ status: 'upcoming', daysRemaining: 16 });
  });

  it('takes the latest service as the one that sets the next due date', () => {
    // The older record's due date was met by the newer service, so it must not raise an alarm.
    const result = analyseVehicle(
      VEHICLE.id,
      [service('2026-01-01', { nextServiceDate: '2026-04-01' }), service('2026-04-05', { nextServiceDate: '2026-10-05' })],
      NOW,
    );
    expect(result.nextService).toMatchObject({ dueDate: '2026-10-05', status: 'scheduled' });
    expect(result.observations.some((o) => o.kind === 'service_due')).toBe(false);
  });

  it('labels an interval-based due date as an estimate', () => {
    const result = analyseVehicle(VEHICLE.id, [service('2026-01-01'), service('2026-02-15'), service('2026-04-01')], NOW);
    expect(result.averageIntervalDays).toBe(45);
    expect(result.nextService).toMatchObject({ source: 'estimate', status: 'overdue', dueDate: '2026-05-16' });
    expect(result.observations.find((o) => o.kind === 'estimated_reminder')?.message).toContain('estimate');
  });

  it('reports a distance-only due point without claiming whether it has been reached', () => {
    const result = analyseVehicle(VEHICLE.id, [service('2026-05-01', { odometerKm: 48_000, nextServiceKm: 58_000 })], NOW);
    expect(result.nextService).toMatchObject({ status: 'scheduled', dueDate: null, dueKm: 58_000 });
    expect(result.observations).toEqual([]);
  });

  it('finds parts and service types that keep coming back', () => {
    const brakes = [{ description: 'Brake pad set', kind: 'PART' }, { description: 'Brake pad set', kind: 'PART' }];
    const result = analyseVehicle(
      VEHICLE.id,
      [
        service('2026-03-01', { serviceType: 'Brake overhaul', lines: brakes }),
        service('2026-05-20', { serviceType: 'brake  overhaul', lines: [{ description: 'brake pad set', kind: 'PART' }] }),
        service('2025-06-01', { serviceType: 'Brake overhaul' }),
      ],
      NOW,
    );
    // Twice inside the window (the 2025 one is outside it), counted once per invoice.
    const part = result.repeatedIssues.find((issue) => issue.kind === 'part');
    const type = result.repeatedIssues.find((issue) => issue.kind === 'service_type');
    expect(part).toMatchObject({ occurrences: 2, firstSeen: '2026-03-01', lastSeen: '2026-05-20' });
    expect(part!.label.toLowerCase()).toBe('brake pad set');
    expect(type).toMatchObject({ occurrences: 2 });
    expect(type!.label.toLowerCase()).toBe('brake overhaul');
    expect(result.observations.find((o) => o.kind === 'repeated_issue')?.message.toLowerCase()).toContain('brake pad set (2×)');
  });

  it('counts frequency and flags unusually frequent servicing', () => {
    const result = analyseVehicle(
      VEHICLE.id,
      ['2026-03-20', '2026-04-10', '2026-05-01', '2026-05-25', '2025-12-01'].map((date) => service(date)),
      NOW,
    );
    expect(result.servicesLast90Days).toBe(4);
    expect(result.servicesLast365Days).toBe(5);
    expect(result.observations.some((o) => o.kind === 'frequent_service')).toBe(true);
  });

  it('summarises recent work, newest first', () => {
    const result = analyseVehicle(VEHICLE.id, [service('2026-01-01', { amount: '100.00' }), service('2026-05-01', { amount: '200.00' })], NOW);
    expect(result.recent.map((r) => r.serviceDate)).toEqual(['2026-05-01', '2026-01-01']);
    expect(result.totalSpend).toBe('300.00');
    expect(result.lastServiceDate).toBe('2026-05-01');
  });
});
