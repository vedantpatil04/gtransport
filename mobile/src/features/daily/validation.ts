import { todayIso } from '../../lib/dates';
import type { FuelTypeValue } from '../../types/domain';

/**
 * Form checks on the phone, mirroring the server's DTO validation so the driver hears about a
 * mistake immediately. The server remains the authority and re-checks everything.
 *
 * Errors are translation keys, so they display in the driver's language.
 */

export type FieldErrors<T extends string> = Partial<Record<T, string>>;

/** Parses "2,450.50" or "2450" into a number; empty or junk gives NaN. */
export function parseAmount(value: string): number {
  const cleaned = value.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

const decimals = (value: string) => value.replace(/[,\s₹]/g, '').split('.')[1]?.length ?? 0;

function checkDate(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'daily.errDate';
  if (value > todayIso()) return 'daily.errFutureDate';
  return undefined;
}

export interface FuelForm {
  fuelType: FuelTypeValue | null;
  amount: string;
  litres: string;
  fuelStation: string;
  date: string;
}

export function validateFuel(form: FuelForm): FieldErrors<keyof FuelForm> {
  const errors: FieldErrors<keyof FuelForm> = {};
  if (!form.fuelType) errors.fuelType = 'daily.errFuelType';

  const amount = parseAmount(form.amount);
  if (!(amount > 0)) errors.amount = 'daily.errAmount';
  else if (decimals(form.amount) > 2) errors.amount = 'daily.errAmountDecimals';

  const litres = parseAmount(form.litres);
  if (!(litres > 0)) errors.litres = 'daily.errLitres';
  else if (decimals(form.litres) > 3) errors.litres = 'daily.errLitresDecimals';

  if (!form.fuelStation.trim()) errors.fuelStation = 'daily.errStation';

  const dateError = checkDate(form.date);
  if (dateError) errors.date = dateError;
  return errors;
}

export interface OperationForm {
  amount: string;
  date: string;
  vendorName: string;
  description: string;
}

export function validateOperation(form: OperationForm): FieldErrors<keyof OperationForm> {
  const errors: FieldErrors<keyof OperationForm> = {};
  const amount = parseAmount(form.amount);
  if (!(amount > 0)) errors.amount = 'daily.errAmount';
  else if (decimals(form.amount) > 2) errors.amount = 'daily.errAmountDecimals';
  const dateError = checkDate(form.date);
  if (dateError) errors.date = dateError;
  return errors;
}

export interface TyreInsuranceForm {
  insurer: string;
  policyNumber: string;
  premium: string;
  startDate: string | null;
  expiryDate: string | null;
}

export function validateTyreInsurance(form: TyreInsuranceForm): FieldErrors<keyof TyreInsuranceForm> {
  const errors: FieldErrors<keyof TyreInsuranceForm> = {};
  if (!form.insurer.trim()) errors.insurer = 'daily.errInsurer';
  if (form.premium.trim() && !(parseAmount(form.premium) >= 0)) errors.premium = 'daily.errAmount';
  if (!form.expiryDate) errors.expiryDate = 'daily.errExpiry';
  if (form.startDate && form.expiryDate && form.startDate > form.expiryDate) errors.startDate = 'daily.errStartAfterExpiry';
  return errors;
}

export const hasErrors = (errors: Record<string, unknown>): boolean => Object.keys(errors).length > 0;
