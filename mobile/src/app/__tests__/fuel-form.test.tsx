import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { displayDate, todayIso } from '../../lib/dates';
import * as submissions from '../../features/daily/submissions';
import NewFuelScreen from '../fuel/new';

jest.mock('../../lib/api/operations', () => ({
  fuelApi: { stations: jest.fn(async () => ['IndianOil', 'HP Petrol Pump']), create: jest.fn(), list: jest.fn() },
  operationsApi: { create: jest.fn(), list: jest.fn(), createTyreInsurance: jest.fn() },
  uploadReceipt: jest.fn(),
  receiptSource: jest.fn(),
}));

describe('driver fuel form', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    useSession.setState({
      token: 'token-1',
      status: 'signedIn',
      driver: { currentAssignment: { vehicle: { registrationNumber: 'KA 22 AB 1234' } } } as never,
    });
  });

  it('asks only for the brief\'s fields — no odometer, rate, vehicle or driver inputs', async () => {
    await render(<NewFuelScreen />);

    for (const id of ['fuel-type-PETROL', 'fuel-type-DIESEL', 'fuel-amount', 'fuel-litres', 'fuel-station', 'fuel-date', 'receipt-camera', 'receipt-gallery', 'fuel-save']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    for (const forbidden of [/odometer/i, /rate per litre/i, /trip/i, /vehicle number/i, /driver name/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
    // The vehicle is shown for reassurance, never typed.
    expect(screen.getByText('KA 22 AB 1234')).toBeTruthy();
  });

  it('dates the entry today by default', async () => {
    await render(<NewFuelScreen />);
    expect(screen.getByText(displayDate(todayIso(), 'en'))).toBeTruthy();
  });

  it('offers recent stations as suggestions', async () => {
    await render(<NewFuelScreen />);
    expect(await screen.findByText('HP Petrol Pump')).toBeTruthy();
    await fireEvent.press(screen.getByText('HP Petrol Pump'));
    expect(screen.getByTestId('fuel-station').props.value).toBe('HP Petrol Pump');
  });

  it('names each missing field instead of saving', async () => {
    const submit = jest.spyOn(submissions, 'submitFuel');
    await render(<NewFuelScreen />);

    await fireEvent.press(screen.getByTestId('fuel-save'));

    expect(await screen.findByText('Choose petrol or diesel')).toBeTruthy();
    expect(screen.getByText('Enter an amount above zero')).toBeTruthy();
    expect(screen.getByText('Enter litres above zero')).toBeTruthy();
    expect(screen.getByText('Enter the fuel station')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('saves with exactly the allowed fields and one submission id, then confirms', async () => {
    const submit = jest.spyOn(submissions, 'submitFuel').mockResolvedValue('pending');
    await render(<NewFuelScreen />);

    await fireEvent.press(screen.getByTestId('fuel-type-PETROL'));
    await fireEvent.changeText(screen.getByTestId('fuel-amount'), '2,450');
    await fireEvent.changeText(screen.getByTestId('fuel-litres'), '25');
    await fireEvent.changeText(screen.getByTestId('fuel-station'), 'IndianOil');
    await fireEvent.press(screen.getByTestId('fuel-save'));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const [body, receipt] = submit.mock.calls[0]!;
    expect(Object.keys(body).sort()).toEqual(['amount', 'clientSubmissionId', 'fuelStation', 'fuelType', 'litres', 'transactionDate']);
    expect(body).toMatchObject({ fuelType: 'PETROL', amount: 2450, litres: 25, fuelStation: 'IndianOil', transactionDate: todayIso() });
    expect(receipt).toBeNull();

    // Offline outcome: the driver is told in plain words.
    expect(await screen.findByText('Saved. Will sync when internet is available.')).toBeTruthy();
  });
});
