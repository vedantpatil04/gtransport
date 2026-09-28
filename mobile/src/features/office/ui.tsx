import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, EmptyView } from '../../components/ui';
import { ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { canOpen, type OfficeModule } from './modules';

/**
 * Shared building blocks for the office app: the same navy header, cards and states as the
 * driver app, so both feel like one product. Every figure comes from the live API; while it
 * loads, a dash — never a sample number.
 */

export const DASH = '—';

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
}

/** Loads with the session token; keeps the last good data visible while refreshing. */
export function useOfficeData<T>(load: (token: string) => Promise<T>, deps: unknown[] = [], enabled = true): Loaded<T> {
  const token = useSession((s) => s.token);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    if (!token || !enabled) {
      setLoading(false);
      return;
    }
    try {
      setData(await loadRef.current(token));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError('unknown', 0, 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled, ...deps]);

  useEffect(() => {
    setLoading(enabled);
    void run();
  }, [run, enabled]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    await run();
    setRefreshing(false);
  }, [run]);

  return { data, error, loading, refreshing, reload };
}

export function OfficeScreen({
  title,
  subtitle,
  onRefresh,
  refreshing = false,
  children,
  testID,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.flex} testID={testID}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <AppText variant="h1" tone="inverse">{title}</AppText>
          {subtitle ? <AppText tone="inverse" style={{ opacity: 0.75 }}>{subtitle}</AppText> : null}
        </View>
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </View>
  );
}

type Tone = 'default' | 'success' | 'warning' | 'danger';

export function StatTile({ label, value, sub, tone = 'default', hero, onPress, testID }: { label: string; value: string; sub?: string; tone?: Tone; hero?: boolean; onPress?: () => void; testID?: string }) {
  const body = (
    <View style={[styles.tile, hero && styles.tileHero]} testID={testID}>
      <AppText variant="label" tone={hero ? 'inverse' : 'muted'} style={hero ? { opacity: 0.8 } : undefined}>{label}</AppText>
      <AppText variant="figure" tone={hero ? 'inverse' : tone === 'default' ? 'default' : tone}>{value}</AppText>
      {sub ? <AppText variant="label" tone={hero ? 'inverse' : 'muted'} style={hero ? { opacity: 0.8 } : undefined}>{sub}</AppText> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  );
}

/** An inline notice for a failed load that keeps any earlier data on screen. */
export function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { t } = useTranslation();
  const offline = error.kind === 'network' || error.kind === 'timeout';
  return (
    <Card style={styles.errorCard}>
      <AppText tone="danger">{offline ? t('states.offline') : t('states.errorBody')}</AppText>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry} testID="retry">
        <AppText tone="success">{t('common.retry')}</AppText>
      </Pressable>
    </Card>
  );
}

/** Guards a module screen reached by a deep link the role may not use. */
export function ModuleGuard({ module, children }: { module: OfficeModule; children: React.ReactNode }) {
  const { t } = useTranslation();
  const role = useSession((s) => s.role);
  if (!canOpen(role, module)) return <EmptyView title={t('office.noAccessTitle')} hint={t('office.noAccessBody')} />;
  return <>{children}</>;
}

export function Pill({ label, tone = 'default' }: { label: string; tone?: Tone }) {
  const palette = {
    default: { bg: colors.muted, fg: colors.mutedForeground },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <AppText variant="label" style={{ color: palette.fg }}>{label}</AppText>
    </View>
  );
}

export const officeStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  half: { flexBasis: '47%', flexGrow: 1 },
  more: { minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  search: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    color: colors.foreground,
  },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.md },
  tile: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
  tileHero: { backgroundColor: colors.primary, borderColor: colors.primary },
  errorCard: { gap: spacing.sm },
  retry: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  pill: { borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' },
});

export function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export interface PagedList<T> {
  rows: T[];
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  reload: () => Promise<void>;
  more: () => Promise<void>;
}

/** A server-paged list: first page on load and refresh, further pages on "Show more". */
export function usePagedList<T>(load: (token: string, cursor?: string) => Promise<{ data: T[]; page: { nextCursor: string | null } }>, deps: unknown[] = [], enabled = true): PagedList<T> {
  const token = useSession((s) => s.token);
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiError | null>(null);
  const first = useOfficeData(
    async (t) => {
      const page = await load(t);
      setExtra([]);
      setCursor(page.page.nextCursor);
      setMoreError(null);
      return page.data;
    },
    deps,
    enabled,
  );
  const more = async () => {
    if (!token || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await load(token, cursor);
      setExtra((rows) => [...rows, ...page.data]);
      setCursor(page.page.nextCursor);
    } catch (cause) {
      setMoreError(cause instanceof ApiError ? cause : new ApiError('unknown', 0, 'Something went wrong.'));
    } finally {
      setLoadingMore(false);
    }
  };
  return {
    rows: [...(first.data ?? []), ...extra],
    error: first.error ?? moreError,
    loading: first.loading && !first.data,
    refreshing: first.refreshing,
    hasMore: Boolean(cursor),
    loadingMore,
    reload: first.reload,
    more,
  };
}

export function ShowMore({ list }: { list: Pick<PagedList<unknown>, 'hasMore' | 'loadingMore' | 'more'> }) {
  const { t } = useTranslation();
  if (!list.hasMore) return null;
  return (
    <Pressable accessibilityRole="button" disabled={list.loadingMore} onPress={() => void list.more()} style={officeStyles.more} testID="office-show-more">
      <AppText tone="success">{list.loadingMore ? t('common.loading') : t('office.showMore')}</AppText>
    </Pressable>
  );
}
