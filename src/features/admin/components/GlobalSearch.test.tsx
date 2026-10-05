import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { employeesApi, vehiclesApi } from '@/features/api/resources';
import { ApiError } from '@/lib/api/client';
import { GlobalSearch } from './GlobalSearch';

vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => true, useConnected: () => true }));
vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  employeesApi: { list: vi.fn() },
  vehiclesApi: { list: vi.fn() },
}));

const people = vi.mocked(employeesApi);
const fleet = vi.mocked(vehiclesApi);
const EMPTY = { data: [], page: { limit: 5, nextCursor: null } };

function search(text: string) {
  render(
    <MemoryRouter>
      <GlobalSearch open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByTestId('search-input'), { target: { value: text } });
}

beforeEach(() => {
  people.list.mockReset();
  fleet.list.mockReset();
});

describe('global search with the live API', () => {
  it('says it is searching — not "nothing found" — while the answer is on its way', async () => {
    people.list.mockReturnValue(new Promise(() => {}));
    fleet.list.mockReturnValue(new Promise(() => {}));
    search('ramesh');

    expect(await screen.findByTestId('search-searching')).toBeTruthy();
    expect(screen.queryByText(/Nothing found/)).toBeNull();
  });

  it('shows a failed search as a failure with a retry, not as an empty result', async () => {
    people.list.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.'));
    fleet.list.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.'));
    search('ramesh');

    expect(await screen.findByTestId('search-failed')).toBeTruthy();
    expect(screen.queryByText(/Nothing found/)).toBeNull();

    people.list.mockResolvedValue(EMPTY);
    fleet.list.mockResolvedValue(EMPTY);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing found for “ramesh”')).toBeTruthy();
  });

  it('says nothing was found only after the server answered with nothing', async () => {
    people.list.mockResolvedValue(EMPTY);
    fleet.list.mockResolvedValue(EMPTY);
    search('zzz');

    expect(await screen.findByText('Nothing found for “zzz”')).toBeTruthy();
  });
});
