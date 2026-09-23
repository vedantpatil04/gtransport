/** Fuel entry vocabulary, aligned with the existing driver UI. */
export const FuelEntrySource = { DRIVER_APP: 'DRIVER_APP', ADMIN: 'ADMIN' } as const;
export type FuelEntrySource = (typeof FuelEntrySource)[keyof typeof FuelEntrySource];

/**
 * A fuel entry submitted from the driver app. `clientEntryId` is generated on the device so
 * an offline entry that syncs twice is stored once — the prototype already queues entries
 * while offline, and the production API must not duplicate them.
 */
export interface FuelEntryDraft {
  clientEntryId: string;
  driverId: string;
  vehicleId: string;
  fuelType: 'PETROL' | 'DIESEL';
  amount: string;
  litres: string;
  station: string;
  filledOn: Date;
  receiptFileId?: string | null;
  source: FuelEntrySource;
}
