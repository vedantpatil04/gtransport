import { ADMIN_WEB_URL } from '../../lib/config';

/**
 * What the office console WebView may load. The console is one site — the production Vercel app —
 * and it must never be replaced by another page. Everything here is pure so it can be tested
 * without a WebView.
 */

export const CONSOLE_ORIGIN = new URL(ADMIN_WEB_URL).origin;

/** The console address that signs the app's account in. The code rides in the fragment, which is never sent over the network. */
export const consoleEntryUrl = (code: string): string => `${CONSOLE_ORIGIN}/#handoff=${encodeURIComponent(code)}`;

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export const isConsoleUrl = (url: string): boolean => originOf(url) === CONSOLE_ORIGIN;

/** Links the console may hand to another app: web pages (maps, Cloudinary files), mail, phone. */
const EXTERNAL_SCHEMES = ['https:', 'mailto:', 'tel:'];

export type NavigationDecision = 'load' | 'external' | 'block';

/**
 * - the console itself loads in place;
 * - inside a frame, only HTTPS and the page's own blob:/data: content (previews of fetched files);
 * - any other top-level HTTPS page, mail or phone link goes to the phone's own app for it, so a
 *   link can never take over the console's window (and with it, the console's session);
 * - everything else — plain HTTP, file:, intent:, javascript: — is refused.
 */
export function decideNavigation(url: string, isTopFrame: boolean): NavigationDecision {
  if (isConsoleUrl(url)) return 'load';
  if (url === 'about:blank') return 'load';
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return 'block';
  }
  if (!isTopFrame) return scheme === 'https:' || scheme === 'blob:' || scheme === 'data:' ? 'load' : 'block';
  return EXTERNAL_SCHEMES.includes(scheme) ? 'external' : 'block';
}

/** Messages the console page sends the app. Anything else is ignored. */
export type ConsoleMessage =
  | { type: 'session-ended'; reason: 'signedOut' | 'expired' }
  | { type: 'download'; filename: string; mimeType: string; data: string }
  | { type: 'download-failed' };

/** Largest file the page may hand over (base64 characters, ≈ 25 MB of file). */
const MAX_DOWNLOAD_CHARS = 34_000_000;

/** Accepts a message only from the console's own origin, and only in a known shape. */
export function parseConsoleMessage(data: string, fromUrl: string): ConsoleMessage | null {
  if (!isConsoleUrl(fromUrl) || data.length > MAX_DOWNLOAD_CHARS + 1_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'session-ended') {
    return message.reason === 'signedOut' || message.reason === 'expired' ? { type: 'session-ended', reason: message.reason } : null;
  }
  if (message.type === 'download') {
    const { filename, mimeType, data: content } = message;
    if (typeof filename !== 'string' || typeof mimeType !== 'string' || typeof content !== 'string') return null;
    if (!content || content.length > MAX_DOWNLOAD_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(content)) return null;
    return { type: 'download', filename, mimeType: mimeType || 'application/octet-stream', data: content };
  }
  if (message.type === 'download-failed') return { type: 'download-failed' };
  return null;
}

/**
 * Runs in the console page before its own scripts. The console saves reports (PDF, Excel) and
 * attachments as in-memory blobs with `<a download>` — which Android's WebView cannot save on
 * its own. This remembers each blob the page creates and, when the page "clicks" a download
 * link to one, posts the file's bytes to the app instead, which saves them where the user
 * chooses. It reads nothing else on the page, and sends nothing anywhere but the app.
 */
export const DOWNLOAD_BRIDGE_SCRIPT = `(function () {
  if (window.__gangamataDownloads || !window.ReactNativeWebView) return;
  window.__gangamataDownloads = true;
  var blobs = new Map();
  var create = URL.createObjectURL.bind(URL);
  var revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (object) {
    var url = create(object);
    if (object instanceof Blob) blobs.set(url, object);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(url);
    revoke(url);
  };
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function send(anchor) {
    if (!anchor || !anchor.hasAttribute || !anchor.hasAttribute('download')) return false;
    var blob = blobs.get(anchor.href);
    if (!blob) return false;
    var filename = anchor.getAttribute('download') || 'download';
    var reader = new FileReader();
    reader.onload = function () {
      var result = String(reader.result);
      post({ type: 'download', filename: filename, mimeType: blob.type || 'application/octet-stream', data: result.slice(result.indexOf(',') + 1) });
    };
    reader.onerror = function () { post({ type: 'download-failed' }); };
    reader.readAsDataURL(blob);
    return true;
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (send(this)) return;
    return click.apply(this, arguments);
  };
  document.addEventListener('click', function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest('a[download]') : null;
    if (anchor && send(anchor)) event.preventDefault();
  }, true);
})();
true;`;
