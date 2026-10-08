import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, BackHandler, Linking, Platform, Pressable, StyleSheet, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { AppText, Loading, PrimaryButton } from '../../components/ui';
import { accountApi } from '../../lib/api/account';
import { ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/auth/session-store';
import { colors, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { saveConsoleFile } from './downloads';
import { consoleEntryUrl, decideNavigation, DOWNLOAD_BRIDGE_SCRIPT, parseConsoleMessage, type ConsoleMessage } from './policy';

/**
 * The office console for SUPER_ADMIN, ADMIN, MANAGER and ACCOUNTING: the production Vercel site,
 * shown as it is in Chrome. The app never rebuilds it.
 *
 * Sign-in is handed over, not repeated: the app asks the API for a one-time, minute-long code and
 * opens the console with it in the address fragment; the console trades it for its own ordinary
 * session and removes it. No password or long-lived token ever goes into a URL.
 *
 * When the console's session ends (sign-out, expiry, an account change) the page says so and the
 * app returns to its own sign-in — never to the driver app.
 */

type Phase = 'connecting' | 'open' | 'offline' | 'failed' | 'forbidden';

/**
 * What actually went wrong, shown under the friendly message so a failure can be diagnosed from a
 * screenshot. Never contains a token or the handoff code: URLs lose their fragment and query.
 */
function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return ['POST /auth/web-handoff', error.status ? `HTTP ${error.status}` : error.kind, error.code, error.requestId && `request ${error.requestId}`]
      .filter(Boolean)
      .join(' · ');
  }
  return error instanceof Error ? error.message : String(error);
}

const withoutSecrets = (url: string | undefined): string => (url ?? '').replace(/[?#].*$/, '');

const reachable = (state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) =>
  Boolean(state.isConnected) && state.isInternetReachable !== false;

export function AdminConsole() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const [phase, setPhase] = useState<Phase>('connecting');
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const [reconnected, setReconnected] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  /** A fresh code every time: a code is spent by its first use, and lives only a minute. */
  const connect = useCallback(async () => {
    setPhase('connecting');
    setLoadFailed(false);
    setDetail(null);
    setReconnected(false);
    if (!token) return;
    if (!reachable(await NetInfo.fetch())) {
      setPhase('offline');
      return;
    }
    try {
      const { code } = await accountApi.webHandoff(token);
      setEntryUrl(consoleEntryUrl(code));
      setAttempt((n) => n + 1);
      setPhase('open');
    } catch (error) {
      setDetail(describeApiError(error));
      // A 401 has already ended the session centrally: the sign-in screen explains it.
      if (error instanceof ApiError && error.kind === 'unauthorized') return;
      if (error instanceof ApiError && error.kind === 'forbidden') setPhase('forbidden');
      else if (error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')) setPhase('offline');
      else setPhase('failed');
    }
  }, [token]);

  useEffect(() => {
    void connect();
  }, [connect]);

  // Offline is said plainly over the console — nothing on screen pretends to be live — and when the
  // connection returns the user decides when to reload, so a half-filled form is never lost.
  const wasOnline = useRef(true);
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        const now = reachable(state);
        setReconnected(!wasOnline.current && now);
        wasOnline.current = now;
        setOnline(now);
      }),
    [],
  );

  // Android back walks back through the console's own pages before leaving the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase !== 'open' || !canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [phase]);

  const signOut = useCallback(async (expired: boolean) => {
    await useSession.getState().signOut();
    if (expired) useSession.setState({ expiredMessage: true });
  }, []);

  const confirmFolder = useCallback(
    () =>
      new Promise<boolean>((resolve) =>
        Alert.alert(
          t('console.chooseFolderTitle'),
          t('console.chooseFolderBody'),
          [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('common.continue'), onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      ),
    [t],
  );

  const save = useCallback(
    (file: Extract<ConsoleMessage, { type: 'download' }>) => {
      // One at a time, so two quick downloads never open two folder pickers.
      saving.current = saving.current.then(async () => {
        const outcome = await saveConsoleFile(file, confirmFolder);
        if (outcome.status === 'saved') {
          const message = t('console.saved', { name: outcome.filename });
          if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.LONG);
          else Alert.alert(message);
        } else if (outcome.status === 'failed') {
          Alert.alert(t('console.saveFailed'));
        }
      });
    },
    [confirmFolder, t],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseConsoleMessage(event.nativeEvent.data, event.nativeEvent.url);
      if (!message) return;
      if (message.type === 'session-ended') void signOut(message.reason === 'expired');
      else if (message.type === 'download') save(message);
      else Alert.alert(t('console.saveFailed'));
    },
    [save, signOut, t],
  );

  const onShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    const decision = decideNavigation(request.url, request.isTopFrame ?? true);
    if (decision === 'external') void Linking.openURL(request.url).catch(() => undefined);
    return decision === 'load';
  }, []);

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    canGoBack.current = state.canGoBack;
  }, []);

  const reload = useCallback(() => {
    setReconnected(false);
    if (loadFailed || !entryUrl) void connect();
    else web.current?.reload();
  }, [connect, entryUrl, loadFailed]);

  let body: React.ReactNode;
  if (phase === 'connecting') body = <Loading label={t('console.connecting')} />;
  else if (phase !== 'open' || loadFailed || !entryUrl) {
    const kind = phase === 'open' ? 'failed' : phase;
    body = (
      <Problem
        title={t(kind === 'offline' ? 'console.offlineTitle' : kind === 'forbidden' ? 'console.forbiddenTitle' : 'console.failedTitle')}
        body={t(kind === 'offline' ? 'console.offlineBody' : kind === 'forbidden' ? 'console.forbiddenBody' : 'console.failedBody')}
        onRetry={kind === 'forbidden' ? undefined : () => void connect()}
        detail={detail}
        onSignOut={() => void signOut(false)}
      />
    );
  } else {
    body = (
      <>
        {!online && <Banner testID="console-offline" text={t('console.offlineBanner')} tone="warning" />}
        {online && reconnected && <Banner testID="console-reconnected" text={t('console.backOnline')} tone="success" action={t('console.reload')} onAction={reload} />}
        <WebView
          key={attempt}
          ref={web}
          testID="console-webview"
          source={{ uri: entryUrl }}
          style={styles.web}
          // Every navigation is decided by onShouldStartLoad; nothing is opened behind its back.
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={onShouldStartLoad}
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={DOWNLOAD_BRIDGE_SCRIPT}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="never"
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          thirdPartyCookiesEnabled={false}
          geolocationEnabled={false}
          // The console's own layout, as in Chrome, whatever the phone's font size.
          textZoom={100}
          startInLoadingState
          renderLoading={() => (
            <View style={StyleSheet.absoluteFill}>
              <Loading label={t('console.connecting')} />
            </View>
          )}
          onError={(event) => {
            const { description, code, url } = event.nativeEvent;
            setDetail([withoutSecrets(url), description, code !== undefined && `code ${code}`].filter(Boolean).join(' · '));
            setLoadFailed(true);
          }}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode < 500) return;
            setDetail(`${withoutSecrets(event.nativeEvent.url)} · HTTP ${event.nativeEvent.statusCode}`);
            setLoadFailed(true);
          }}
          // Android may stop the page's renderer to free memory; start again rather than show a blank.
          onRenderProcessGone={() => void connect()}
          downloadingMessage={t('console.downloading')}
          lackPermissionToDownloadMessage={t('console.noDownloadPermission')}
          webviewDebuggingEnabled={__DEV__}
        />
      </>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={{ height: insets.top, backgroundColor: colors.primary }} />
      {body}
    </View>
  );
}

function Problem({ title, body, detail, onRetry, onSignOut }: { title: string; body: string; detail?: string | null; onRetry?: () => void; onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.problem} testID="console-problem">
      <AppText variant="h2" style={{ textAlign: 'center' }}>{title}</AppText>
      <AppText tone="muted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>{body}</AppText>
      {detail ? (
        <AppText variant="label" tone="muted" style={styles.detail} testID="console-error-detail">
          {detail}
        </AppText>
      ) : null}
      {onRetry && (
        <View style={styles.action}>
          <PrimaryButton label={t('common.retry')} onPress={onRetry} testID="console-retry" />
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={onSignOut} testID="console-sign-out" style={styles.secondary}>
        <AppText tone="muted">{t('console.signOut')}</AppText>
      </Pressable>
    </View>
  );
}

function Banner({ text, tone, action, onAction, testID }: { text: string; tone: 'warning' | 'success'; action?: string; onAction?: () => void; testID: string }) {
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: tone === 'warning' ? colors.warningSoft : colors.successSoft }]}>
      <AppText variant="label" tone={tone} style={{ flex: 1 }}>{text}</AppText>
      {action && onAction && (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.bannerAction}>
          <AppText variant="label" tone={tone} style={{ fontWeight: '700' }}>{action}</AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  web: { flex: 1, backgroundColor: colors.background },
  problem: { flex: 1, justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.background },
  detail: { marginTop: spacing.md, textAlign: 'center', fontFamily: 'monospace', fontSize: 12 },
  action: { marginTop: spacing.lg, alignSelf: 'stretch' },
  secondary: { marginTop: spacing.md, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  bannerAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
});
