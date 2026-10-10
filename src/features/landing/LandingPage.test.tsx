import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/store';
import { AppRoutes } from '@/routes';
import { DRIVER_APP, formatMegabytes } from './driverApp';

const mode = vi.hoisted(() => ({ api: true }));
vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => mode.api, useConnected: () => mode.api }));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const phoneApp = () => ((window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: () => undefined });

beforeEach(() => {
  mode.api = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  useApp.getState().logout('admin');
});

describe('public home page', () => {
  it('opens at "/" in an ordinary browser, with the two ways in', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Fleet management for Gangamata Transport/ })).toBeTruthy();
    expect(where()).toBe('/');

    const office = screen.getByTestId('landing-office-login');
    expect(office.getAttribute('href')).toBe('/admin');
    expect(office.textContent).toMatch(/Office \/ Admin Login/);

    const download = screen.getByTestId('landing-download');
    expect(download.getAttribute('href')).toBe('/downloads/gangamata-transport.apk');
    expect(download.getAttribute('download')).toBe('gangamata-driver-release.apk');
    expect(download.textContent).toMatch(/Driver\? Download Android App/);
  });

  it('Office / Admin Login opens the existing console sign-in at /admin', async () => {
    renderAt('/');
    fireEvent.click(await screen.findByTestId('landing-office-login'));
    expect(where()).toBe('/admin');
    expect(await screen.findByRole('heading', { name: /Office sign in/i })).toBeTruthy();
  });

  it('keeps the existing console addresses working when typed directly', async () => {
    renderAt('/admin/finance/payments?status=pending');
    expect(await screen.findByRole('heading', { name: /Office sign in/i })).toBeTruthy();
    expect(where()).toBe('/admin/finance/payments?status=pending');
    expect(screen.queryByTestId('landing-office-login')).toBeNull();
  });

  it('inside the phone app "/" goes straight to the console, never the home page', async () => {
    phoneApp();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: /Office sign in/i })).toBeTruthy();
    expect(where()).toBe('/admin');
    expect(screen.queryByTestId('landing-download')).toBeNull();
  });

  it('leaves the no-API demo prototype on its own entry', async () => {
    mode.api = false;
    useApp.getState().login('admin');
    renderAt('/');
    await screen.findByTestId('where');
    expect(where()).not.toBe('/');
    expect(screen.queryByTestId('landing-download')).toBeNull();
  });

  it('shows the version, size and Android requirement of the file it links to', async () => {
    renderAt('/');
    const facts = (await screen.findByTestId('landing-app-facts')).textContent ?? '';
    expect(facts).toContain(`version ${DRIVER_APP.versionName}`);
    expect(facts).toContain('139.7 MB');
    expect(facts).toContain('Android 7.0 or newer');
    expect(screen.getByTestId('landing-sha256').textContent).toBe(DRIVER_APP.sha256);
  });

  it('gives short install steps without ever telling anyone to turn off device protection', async () => {
    renderAt('/');
    const steps = (await screen.findByTestId('landing-install')).textContent ?? '';
    expect(steps).toMatch(/allow it for this one app only/);
    expect(steps).toMatch(/Install unknown apps/);
    expect(steps.toLowerCase()).not.toMatch(/play protect|disable|turn off (play|security|protection)|security (settings|check)/);
  });

  it('invents no contact details: no phone, mail or address links or text', async () => {
    const { container } = renderAt('/');
    await screen.findByTestId('landing-download');
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\+91|@|Old P\.B\. Road|Belagavi|Contact us/i);
  });
});

describe('driver app details', () => {
  it('formats the size the way phones and file managers count it', () => {
    expect(formatMegabytes(DRIVER_APP.sizeBytes)).toBe('139.7 MB');
    expect(formatMegabytes(1_048_576)).toBe('1.0 MB');
  });

  it('records a SHA-256 and a package that match the production build', () => {
    expect(DRIVER_APP.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(DRIVER_APP.packageName).toBe('in.gangamatatransport.driver');
  });
});

describe('Vercel routing for the download', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', 'vercel.json'), 'utf8')) as {
    rewrites: { source: string; destination: string }[];
    redirects: { source: string; destination: string; permanent: boolean }[];
  };
  const spa = new RegExp(`^${config.rewrites[0]!.source}$`);

  it('still sends every console address to the app', () => {
    for (const path of ['/', '/admin', '/admin/fleet', '/admin/finance/payments', '/assets/index.js', '/branding/gangamata-mark.png']) {
      expect(spa.test(path), path).toBe(true);
    }
    expect(config.rewrites[0]!.destination).toBe('/index.html');
  });

  it('never answers a download address with the app\'s index.html (a missing file must be a 404, not a fake .apk)', () => {
    expect(spa.test(DRIVER_APP.downloadPath)).toBe(false);
    expect(spa.test('/downloads/anything-else.apk')).toBe(false);
  });

  it('sends the download address to the release asset on the public repository, as a temporary redirect', () => {
    const redirect = config.redirects.find((entry) => entry.source === DRIVER_APP.downloadPath);
    expect(redirect).toBeDefined();
    const target = new URL(redirect!.destination);
    expect(target.origin).toBe('https://github.com');
    expect(target.pathname).toMatch(/^\/vedantpatil04\/GangamataTransport\/releases\/download\/driver-v[\d.]+\/gangamata-driver-release\.apk$/);
    // Temporary, so a new release (or another host) can replace it without browsers remembering the old one.
    expect(redirect!.permanent).toBe(false);
  });
});
