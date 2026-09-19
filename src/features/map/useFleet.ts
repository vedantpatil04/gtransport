import { useMemo } from 'react';
import { positionFor, type FleetPosition } from '@/data/geo';
import { useNow } from '@/hooks/useNow';
import { useApp } from '@/store';
import type { Driver, MotionState, Vehicle } from '@/types';

export interface FleetItem {
  driver: Driver;
  vehicle: Vehicle | null;
  pos: FleetPosition;
}

/** Live (simulated) positions for every active driver. Re-computed on a short tick. */
export function useFleet(intervalMs = 3000) {
  const now = useNow(intervalMs);
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const items = useMemo<FleetItem[]>(
    () =>
      drivers
        .filter((d) => d.status === 'active')
        .map((d) => ({ driver: d, vehicle: vehicles.find((v) => v.id === d.vehicleId) ?? null, pos: positionFor(d, now) }))
        .map((it) => (it.vehicle ? it : { ...it, pos: { ...it.pos, motion: 'none' as MotionState, updatedAt: null, speedKmh: 0 } })),
    [drivers, vehicles, now],
  );
  const counts = useMemo(() => {
    const c: Record<MotionState, number> = { moving: 0, stopped: 0, offline: 0, none: 0 };
    for (const it of items) c[it.pos.motion] += 1;
    return c;
  }, [items]);
  return { items, counts, now };
}
