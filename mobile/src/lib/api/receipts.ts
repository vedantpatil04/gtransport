import type { DriverReceiptState, DriverServiceReceipt } from '../../types/domain';
import { apiRequest } from './client';

/**
 * A driver's own service receipts, and how far each one has got.
 *
 * There is no driver id on the route: the server takes it from the session, so one driver cannot
 * ask after another's uploads. And the response carries no provider, no model and no confidence —
 * the server decides what a driver is told, and this client has nothing else to show even if it
 * wanted to.
 */
export const serviceReceiptsApi = {
  mine: (token: string, limit = 20) =>
    apiRequest<{ data: DriverServiceReceipt[] }>(`/service-receipts/mine?limit=${limit}`, { token }),
};

export type { DriverReceiptState, DriverServiceReceipt };
