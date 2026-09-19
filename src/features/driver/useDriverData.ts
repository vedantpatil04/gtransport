import { useMemo } from 'react';
import { positionFor } from '@/data/geo';
import { docStatus } from '@/features/documents/expiry';
import { useNow } from '@/hooks/useNow';
import { useApp, useCurrentDriver } from '@/store';
import type { DocRecord } from '@/types';

/** Documents that concern the signed-in driver: their own + their assigned vehicle's. */
export function useMyDocuments() {
  const driver = useCurrentDriver();
  const documents = useApp((s) => s.documents);
  return useMemo(() => {
    const vehicleDocs = driver.vehicleId ? documents.filter((d) => d.ownerType === 'vehicle' && d.ownerId === driver.vehicleId) : [];
    const driverDocs = documents.filter((d) => d.ownerType === 'driver' && d.ownerId === driver.id);
    const all = [...vehicleDocs, ...driverDocs];
    const urgent = [...all].filter((d) => docStatus(d).level > 0).sort((a, b) => docStatus(b).level - docStatus(a).level || (docStatus(a).days ?? 0) - (docStatus(b).days ?? 0));
    return { vehicleDocs, driverDocs, all, urgent: urgent as DocRecord[] };
  }, [documents, driver.id, driver.vehicleId]);
}

export function useMyVehicle() {
  const driver = useCurrentDriver();
  return useApp((s) => s.vehicles.find((v) => v.id === driver.vehicleId) ?? null);
}

export function useMyPosition(intervalMs = 15_000) {
  const driver = useCurrentDriver();
  const now = useNow(intervalMs);
  return { position: positionFor(driver, now), now };
}

export function useUnreadCount(audience: string) {
  return useApp((s) => s.notifications.filter((n) => n.audience === audience && !n.read).length);
}
