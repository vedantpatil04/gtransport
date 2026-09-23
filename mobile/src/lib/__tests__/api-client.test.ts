import { ApiError, apiRequest, setUnauthorizedHandler } from '../api/client';

const mockFetch = (impl: jest.Mock) => {
  (global as unknown as { fetch: jest.Mock }).fetch = impl;
};

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fail = (status: number, body: unknown) => ({ ok: false, status, text: async () => JSON.stringify(body) });

describe('api client', () => {
  afterEach(() => {
    jest.clearAllMocks();
    setUnauthorizedHandler(null);
  });

  it('calls the configured API with the versioned path and bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok({ id: 'd1' }));
    mockFetch(fetchMock);

    await expect(apiRequest('/drivers/me', { token: 'abc' })).resolves.toEqual({ id: 'd1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test.gangamata/api/v1/drivers/me');
    expect(init.headers.Authorization).toBe('Bearer abc');
  });

  it('maps the API error envelope onto a typed error', async () => {
    mockFetch(jest.fn().mockResolvedValue(fail(400, { error: { message: 'Bad number', code: 'VALIDATION_FAILED', requestId: 'req-1' } })));

    await expect(apiRequest('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      kind: 'validation',
      status: 400,
      message: 'Bad number',
      requestId: 'req-1',
    });
  });

  it('signs the driver out once when the session is rejected', async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch(jest.fn().mockResolvedValue(fail(401, { error: { message: 'no' } })));

    await expect(apiRequest('/drivers/me', { token: 'stale' })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('retries a failed GET and succeeds on a later attempt', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(ok({ id: 'd1' }));
    mockFetch(fetchMock);

    await expect(apiRequest('/drivers/me', { token: 'abc', retries: 1 })).resolves.toEqual({ id: 'd1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a write, so a submission cannot be duplicated', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    mockFetch(fetchMock);

    await expect(apiRequest('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure in words a driver can act on', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const error = (await apiRequest('/drivers/me', { retries: 0 }).catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/Unable to connect/i);
  });
});
