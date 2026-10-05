import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fuelApi } from '@/features/api/resources';
import type { ApiFuelEntry } from '@/features/api/types';
import { ApiError } from '@/lib/api/client';
import { FuelEditDialog } from './FuelEditDialog';

vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  fuelApi: { update: vi.fn() },
}));

const api = vi.mocked(fuelApi);

const ENTRY: ApiFuelEntry = {
  id: 'f1', fuelType: 'DIESEL', amount: '2450.00', litres: '25.300', ratePerLitre: '96.84', fuelStation: 'IndianOil – NH4',
  transactionDate: '2026-10-01', receiptFileId: null, status: 'ACTIVE', notes: null, archivedAt: null, archiveReason: null,
  createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z',
  driver: { id: 'd1', driverCode: 'DRV-001', fullName: 'Ramesh Kumar' }, vehicle: { id: 'v1', registrationNumber: 'KA 22 AB 1234' },
};

function renderDialog() {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(<FuelEditDialog entry={ENTRY} onOpenChange={onOpenChange} onSaved={onSaved} />);
  return { onSaved, onOpenChange };
}

beforeEach(() => {
  api.update.mockReset();
});

describe('office fuel correction', () => {
  it('opens on the recorded values, with the driver and vehicle shown but not editable', () => {
    renderDialog();
    expect((screen.getByLabelText('Amount (₹)') as HTMLInputElement).value).toBe('2450');
    expect((screen.getByLabelText('Litres') as HTMLInputElement).value).toBe('25.3');
    expect((screen.getByLabelText('Fuel station') as HTMLInputElement).value).toBe('IndianOil – NH4');
    expect(screen.getByText('Ramesh Kumar')).toBeTruthy();
    expect(screen.queryByLabelText('Driver')).toBeNull();
  });

  it('checks the same rules as the API before sending anything', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '12.345' } });
    fireEvent.change(screen.getByLabelText('Litres'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Fuel station'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('fuel-edit-save'));

    expect(screen.getByText('Enter an amount above zero, with at most 2 decimal places.')).toBeTruthy();
    expect(screen.getByText('Enter litres above zero, with at most 3 decimal places.')).toBeTruthy();
    expect(screen.getByText('Enter the fuel station.')).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('saves the correction and reports it only once the API has accepted it', async () => {
    api.update.mockResolvedValue({ ...ENTRY, amount: '2500.00' });
    const { onSaved, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '2500' } });
    fireEvent.click(screen.getByTestId('fuel-edit-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith('f1', {
      fuelType: 'DIESEL', amount: 2500, litres: 25.3, fuelStation: 'IndianOil – NH4', transactionDate: '2026-10-01', notes: undefined,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open with the server’s reason when the save fails', async () => {
    api.update.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Restore this entry before editing it.'));
    const { onSaved, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId('fuel-edit-save'));

    expect(await screen.findByText('Restore this entry before editing it.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
