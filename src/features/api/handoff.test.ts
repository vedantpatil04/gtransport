import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/features/api/session';
import { startNativeHandoff, takeHandoffCode } from './handoff';

const CODE = 'A'.repeat(43);
const account = (role: string) => ({
  id: 'u1',
  role,
  companyId: 'c1',
  employeeId: 'e1',
  driverId: null,
  status: 'ACTIVE',
  mustChangePassword: false,
  displayName: 'Priya Office',
  email: 'priya@example.test',
  phone: null,
});

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let posted: string[];

beforeEach(() => {
  posted = [];
  useSession.setState({ token: null, user: null, expiresAt: null, endedMessage: false, handoffPending: false });
  window.history.replaceState(null, '', '/admin');
});

afterEach(() => {
  delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  vi.unstubAllGlobals();
});

const insideApp = () => {
  (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(m) };
};

describe('phone app → console handoff', () => {
  it('strips the code from the address, keeping the rest of it', () => {
    window.history.replaceState(null, '', `/admin/fleet?x=1#handoff=${CODE}&tab=map`);
    expect(takeHandoffCode()).toBe(CODE);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/admin/fleet?x=1#tab=map');
    expect(takeHandoffCode()).toBeNull();
  });

  it('ignores a handoff in an ordinary browser, so a crafted link signs nobody in', () => {
    const fetch = respond(200, {});
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState(null, '', `/#handoff=${CODE}`);
    startNativeHandoff();
    expect(window.location.hash).toBe('');
    expect(fetch).not.toHaveBeenCalled();
    expect(useSession.getState().token).toBeNull();
  });

  it('inside the app, exchanges the code once for an ordinary session, replacing any older one', async () => {
    insideApp();
    useSession.setState({ token: 'someone-elses-token', user: account('ADMIN') as never });
    const fetch = respond(200, { accessToken: 'console-token', expiresAt: null, expiresIn: '12h', user: account('MANAGER') });
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState(null, '', `/#handoff=${CODE}`);

    startNativeHandoff();
    expect(window.location.hash).toBe('');
    expect(useSession.getState()).toMatchObject({ token: null, handoffPending: true });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/web-handoff\/exchange$/);
    expect(JSON.parse(String(init.body))).toEqual({ code: CODE });
    expect(useSession.getState()).toMatchObject({ token: 'console-token', handoffPending: false, user: { role: 'MANAGER' } });
    expect(posted).toEqual([]);
  });

  it('tells the app when the code is refused, and when the console signs out', async () => {
    insideApp();
    vi.stubGlobal('fetch', respond(401, { error: { message: 'This sign-in link has expired.' } }));
    window.history.replaceState(null, '', `/#handoff=${CODE}`);
    startNativeHandoff();
    await settle();
    expect(useSession.getState()).toMatchObject({ token: null, handoffPending: false });
    expect(posted.map((m) => JSON.parse(m))).toEqual([{ type: 'session-ended', reason: 'expired' }]);

    posted.length = 0;
    useSession.setState({ token: 'console-token', user: account('ADMIN') as never });
    useSession.getState().signOut();
    expect(posted.map((m) => JSON.parse(m))).toEqual([{ type: 'session-ended', reason: 'signedOut' }]);
  });

  it('refuses a driver account even with a valid code', async () => {
    insideApp();
    vi.stubGlobal('fetch', respond(200, { accessToken: 'driver-token', expiresAt: null, expiresIn: '12h', user: account('DRIVER') }));
    window.history.replaceState(null, '', `/#handoff=${CODE}`);
    startNativeHandoff();
    await settle();
    expect(useSession.getState().token).toBeNull();
    expect(posted.map((m) => JSON.parse(m))).toEqual([{ type: 'session-ended', reason: 'expired' }]);
  });
});
