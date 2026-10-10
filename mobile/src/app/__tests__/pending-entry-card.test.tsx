import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { PendingEntryCard } from '../../features/daily/PendingEntryCard';
import { discardEntry, retryEntry, sendWithoutPhoto, type PendingEntry } from '../../features/daily/submissions';
import { initI18n, setLanguage } from '../../i18n';

jest.mock('../../features/daily/submissions', () => ({
  ...jest.requireActual('../../features/daily/submissions'),
  retryEntry: jest.fn(),
  discardEntry: jest.fn(),
  sendWithoutPhoto: jest.fn(),
}));

const base: PendingEntry = { id: 'e1', kind: 'operation.create', state: 'PENDING_SYNC', amount: 10_000, date: '2026-10-08', label: 'RTO', attempts: 0, canSendWithoutPhoto: false };

describe('an entry still on the phone', () => {
  beforeAll(async () => {
    await initI18n();
    await setLanguage('en');
  });
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => cleanup());

  it('Pending: "Waiting to sync", nothing to press until it has failed once', async () => {
    await render(<PendingEntryCard entry={base} />);
    expect(screen.getByTestId('pending-state-e1').props.children).toBe('Waiting to sync');
    expect(screen.queryByTestId('pending-retry-e1')).toBeNull();
    expect(screen.queryByTestId('pending-discard-e1')).toBeNull();
  });

  it('Pending after a failed try: says it will retry by itself, why it could not, and offers Retry now', async () => {
    await render(<PendingEntryCard entry={{ ...base, attempts: 2, reason: 'Unable to connect right now.', reference: 'cf871239' }} />);
    expect(screen.getByTestId('pending-state-e1').props.children).toBe('Waiting to sync');
    expect(screen.getByTestId('pending-reason-e1').props.children).toBe('Will retry automatically · Unable to connect right now.');
    expect(screen.getByText('Reference cf871239')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('pending-retry-e1'));
    expect(retryEntry).toHaveBeenCalledWith('e1');
    expect(screen.queryByTestId('pending-discard-e1')).toBeNull();
  });

  it('Syncing: shown only while it is being sent, with no buttons to press', async () => {
    await render(<PendingEntryCard entry={{ ...base, state: 'SYNCING', attempts: 1 }} />);
    expect(screen.getByTestId('pending-state-e1').props.children).toBe('Sending…');
    expect(screen.queryByTestId('pending-retry-e1')).toBeNull();
  });

  it('Failed: shows the reason, and offers Retry now and Discard — discarding is always the driver\'s choice', async () => {
    await render(<PendingEntryCard entry={{ ...base, state: 'REJECTED', attempts: 1, reason: 'No vehicle is assigned to you.' }} />);
    expect(screen.getByTestId('pending-state-e1').props.children).toBe('Failed');
    expect(screen.getByTestId('pending-reason-e1').props.children).toBe('No vehicle is assigned to you.');

    await fireEvent.press(screen.getByTestId('pending-retry-e1'));
    expect(retryEntry).toHaveBeenCalledWith('e1');
    expect(discardEntry).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('pending-discard-e1'));
    expect(discardEntry).toHaveBeenCalledWith('e1');
  });

  it('Failed because the photo is gone: offers to send the entry without it, as the driver chooses', async () => {
    await render(<PendingEntryCard entry={{ ...base, state: 'REJECTED', attempts: 1, reason: 'The photo or file is no longer on this phone.', canSendWithoutPhoto: true }} />);
    expect(screen.getByText('Send without photo')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('pending-send-without-photo-e1'));
    expect(sendWithoutPhoto).toHaveBeenCalledWith('e1');
    expect(discardEntry).not.toHaveBeenCalled();
  });

  it('does not offer it for any other kind of failure', async () => {
    await render(<PendingEntryCard entry={{ ...base, state: 'REJECTED', attempts: 1, reason: 'No vehicle is assigned to you.' }} />);
    expect(screen.queryByTestId('pending-send-without-photo-e1')).toBeNull();
  });
});
