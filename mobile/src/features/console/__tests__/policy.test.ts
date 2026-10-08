import { ADMIN_WEB_URL, API_URL, PRODUCTION_ADMIN_WEB_URL } from '../../../lib/config';
import { CONSOLE_ORIGIN, consoleEntryUrl, decideNavigation, DOWNLOAD_BRIDGE_SCRIPT, parseConsoleMessage } from '../policy';

const PAGE = 'https://gtransportt.vercel.app/admin/reports';

describe('office console policy', () => {
  it('is the production Vercel console, over HTTPS', () => {
    expect(PRODUCTION_ADMIN_WEB_URL).toBe('https://gtransportt.vercel.app');
    expect(ADMIN_WEB_URL).toBe('https://gtransportt.vercel.app');
    expect(CONSOLE_ORIGIN).toBe('https://gtransportt.vercel.app');
    expect(API_URL.startsWith('https://')).toBe(true);
  });

  it('hands the one-time code over in the fragment, never in the path or query', () => {
    const url = new URL(consoleEntryUrl('abc_DEF-123'));
    expect(url.origin).toBe('https://gtransportt.vercel.app');
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#handoff=abc_DEF-123');
  });

  it('loads only the console itself in the window', () => {
    expect(decideNavigation('https://gtransportt.vercel.app/admin/fleet', true)).toBe('load');
    expect(decideNavigation('about:blank', true)).toBe('load');
    // Lookalikes and plain HTTP are not the console.
    expect(decideNavigation('https://gtransportt.vercel.app.evil.test/', true)).toBe('external');
    expect(decideNavigation('http://gtransportt.vercel.app/', true)).toBe('block');
  });

  it('sends other web pages, mail and phone links to the phone, and refuses everything else', () => {
    expect(decideNavigation('https://www.google.com/maps?q=12.9,77.5', true)).toBe('external');
    expect(decideNavigation('https://res.cloudinary.com/x/raw/upload/report.pdf', true)).toBe('external');
    expect(decideNavigation('mailto:office@example.test', true)).toBe('external');
    expect(decideNavigation('tel:+919845012345', true)).toBe('external');
    for (const url of ['http://example.test/', 'file:///sdcard/x', 'intent://scan#Intent;end', 'javascript:alert(1)', 'not a url']) {
      expect(decideNavigation(url, true)).toBe('block');
    }
  });

  it('lets frames show HTTPS and the page’s own previews, nothing else', () => {
    expect(decideNavigation('https://tiles.openfreemap.org/x', false)).toBe('load');
    expect(decideNavigation('blob:https://gtransportt.vercel.app/1234', false)).toBe('load');
    expect(decideNavigation('http://example.test/', false)).toBe('block');
    expect(decideNavigation('file:///etc/hosts', false)).toBe('block');
  });

  describe('messages from the page', () => {
    it('accepts the known messages from the console only', () => {
      const ended = JSON.stringify({ type: 'session-ended', reason: 'signedOut' });
      expect(parseConsoleMessage(ended, PAGE)).toEqual({ type: 'session-ended', reason: 'signedOut' });
      expect(parseConsoleMessage(ended, 'https://example.test/')).toBeNull();
      expect(parseConsoleMessage(JSON.stringify({ type: 'session-ended', reason: 'other' }), PAGE)).toBeNull();
      expect(parseConsoleMessage('{not json', PAGE)).toBeNull();
      expect(parseConsoleMessage(JSON.stringify({ type: 'navigate', url: 'https://x' }), PAGE)).toBeNull();
    });

    it('accepts a download only as base64 with a name', () => {
      const ok = { type: 'download', filename: 'Fuel report.pdf', mimeType: 'application/pdf', data: 'JVBERi0xLjQK' };
      expect(parseConsoleMessage(JSON.stringify(ok), PAGE)).toEqual(ok);
      expect(parseConsoleMessage(JSON.stringify({ ...ok, data: 'not base64!' }), PAGE)).toBeNull();
      expect(parseConsoleMessage(JSON.stringify({ ...ok, data: '' }), PAGE)).toBeNull();
      expect(parseConsoleMessage(JSON.stringify({ ...ok, filename: 3 }), PAGE)).toBeNull();
    });
  });

  it('bridges blob downloads and nothing else', () => {
    // Parses as JavaScript, and only ever posts to the app.
    expect(() => new Function(DOWNLOAD_BRIDGE_SCRIPT)).not.toThrow();
    expect(DOWNLOAD_BRIDGE_SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|document\.cookie/);
  });
});
