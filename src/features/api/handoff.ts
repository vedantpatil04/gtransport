import { useSession } from '@/features/api/session';
import { useApp } from '@/store';

/**
 * The office console inside the Gangamata Transport phone app.
 *
 * Office staff sign in on the phone; the app then opens this console in a WebView at
 * `/#handoff=<one-time code>`. The code lives in the fragment, so it is never sent to Vercel or
 * written to any request log; it is stripped from the address before anything renders, and
 * exchanged once with the API for an ordinary console session — stored exactly as a sign-in is.
 *
 * Only the phone app may hand a session in. A plain browser ignores the fragment, so a link
 * crafted elsewhere cannot sign anyone into somebody else's account.
 */

const HANDOFF_KEY = 'handoff';

interface NativeHost {
  postMessage: (message: string) => void;
}

/** The bridge react-native-webview gives pages it hosts; absent in every ordinary browser. */
const nativeHost = (): NativeHost | null => (window as unknown as { ReactNativeWebView?: NativeHost }).ReactNativeWebView ?? null;

export const inNativeApp = (): boolean => nativeHost() !== null;

/** What the console tells the phone app. Never carries a token or any account detail. */
export type NativeHostMessage = { type: 'session-ended'; reason: 'signedOut' | 'expired' };

export function notifyNativeApp(message: NativeHostMessage): void {
  try {
    nativeHost()?.postMessage(JSON.stringify(message));
  } catch {
    /* the host is gone; nothing to tell */
  }
}

/** Removes `handoff=…` from the address fragment (always), returning the code when one was there. */
export function takeHandoffCode(): string | null {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = fragment.get(HANDOFF_KEY);
  if (code === null) return null;
  fragment.delete(HANDOFF_KEY);
  const rest = fragment.toString();
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}${rest ? `#${rest}` : ''}`);
  return code || null;
}

let watching = false;

/**
 * Runs once, before the first render: consumes a handoff from the phone app, and from then on
 * tells the app when the console session ends (sign-out or expiry) so it can show its own sign-in
 * instead of leaving a second login form inside the app.
 */
export function startNativeHandoff(): void {
  const code = takeHandoffCode();
  if (!inNativeApp()) return;

  if (code) {
    void useSession
      .getState()
      .signInWithHandoff(code)
      .then(() => useApp.getState().login('admin'))
      .catch(() => notifyNativeApp({ type: 'session-ended', reason: 'expired' }));
  }

  if (watching) return;
  watching = true;
  useSession.subscribe((state, previous) => {
    if (state.handoffPending || !previous.token || state.token) return;
    notifyNativeApp({ type: 'session-ended', reason: state.endedMessage ? 'expired' : 'signedOut' });
  });
}
