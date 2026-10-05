import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText, Card, EmptyView, Loading } from '../../components/ui';
import {
  LoadError,
  ModuleGuard,
  OfficeScreen,
  officeStyles,
  Pill,
  ShowMore,
  useDebounced,
  useOfficeData,
  usePagedList,
} from '../../features/office/ui';
import { officeApi, type OfficeInboxDetail, type OfficeInboxMessage } from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import { relativeTime } from '../../lib/relative';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

type InboxStatusFilter = '' | 'UNREAD' | 'READ' | 'ARCHIVED';

const STATUS_FILTERS: InboxStatusFilter[] = ['', 'UNREAD', 'READ', 'ARCHIVED'];

/** The office's categories (see the API's InboxClassification); unknown ones read as "Not sorted". */
const CATEGORIES = new Set([
  'VEHICLE_DOCUMENT', 'FUEL', 'MAINTENANCE', 'FINANCE', 'SALARY_PAYMENT', 'COMPLIANCE', 'VENDOR', 'CUSTOMER', 'GENERAL', 'SPAM', 'UNCLASSIFIED',
]);

/** Why an attachment was not kept. Something arrived; the office should know why it is not here. */
const SKIP_REASONS = new Set(['suspicious_extension', 'unsupported_type', 'too_large', 'empty', 'download_failed']);

function classificationTone(category: string): 'default' | 'success' | 'warning' | 'danger' {
  switch (category) {
    case 'FINANCE':
    case 'SALARY_PAYMENT':
      return 'success';
    case 'COMPLIANCE':
      return 'warning';
    case 'SPAM':
      return 'danger';
    default:
      return 'default';
  }
}

/** Contacting the mailbox is a fleet-management act on the API; other roles only read. */
const MAY_SYNC = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER']);

function useCategoryLabel() {
  const { t } = useTranslation();
  return (category: string) => t(`office.inbox.class.${CATEGORIES.has(category) ? category : 'UNCLASSIFIED'}`);
}

/** Detail sheet for one message. */
function MessageDetailModal({
  messageId,
  onClose,
  onStatusChanged,
}: {
  messageId: string | null;
  onClose: () => void;
  onStatusChanged: () => void;
}) {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const token = useSession((s) => s.token);
  const [detail, setDetail] = useState<OfficeInboxDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!messageId || !token) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    setUpdateFailed(false);
    try {
      setDetail(await officeApi.inboxMessage(token, messageId));
    } catch {
      setDetail(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [messageId, token]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!messageId) return null;

  const handleSetStatus = async (nextStatus: 'UNREAD' | 'READ' | 'ARCHIVED') => {
    if (!token || !detail || updating) return;
    setUpdating(true);
    setUpdateFailed(false);
    try {
      await officeApi.inboxSetStatus(token, detail.id, nextStatus);
      setDetail((prev) => (prev ? { ...prev, status: nextStatus } : null));
      onStatusChanged();
    } catch {
      // Nothing changed on the server, so nothing changes here — and the office is told so.
      setUpdateFailed(true);
    } finally {
      setUpdating(false);
    }
  };

  const reading = detail?.aiResults?.[0];

  return (
    <Modal visible={Boolean(messageId)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet} testID="inbox-message-detail">
          <View style={modalStyles.headerRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="h2" numberOfLines={2}>
                {detail ? detail.subject || t('office.inbox.noSubject') : t('office.inbox.message')}
              </AppText>
              {detail && (
                <AppText variant="label" tone="muted">
                  {detail.from.name ? `${detail.from.name} · ` : ''}
                  {detail.from.address} · {relativeTime(detail.receivedAt, t)}
                </AppText>
              )}
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={modalStyles.closeBtn} accessibilityLabel={t('common.close')}>
              <AppText variant="h2" tone="muted">✕</AppText>
            </Pressable>
          </View>

          {loading ? (
            <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
              <Loading />
            </View>
          ) : !detail ? (
            <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
              <AppText tone={loadFailed ? 'danger' : 'muted'}>{t('office.inbox.detailFailed')}</AppText>
              <Pressable accessibilityRole="button" onPress={() => void loadDetail()} style={modalStyles.retry} testID="inbox-detail-retry">
                <AppText tone="success">{t('common.retry')}</AppText>
              </Pressable>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm }}>
              <View style={officeStyles.row}>
                <Pill label={categoryLabel(detail.classification)} tone={classificationTone(detail.classification)} />
                <Pill label={t(`office.inbox.status.${detail.status}`, { defaultValue: detail.status })} />
              </View>

              {detail.ai.status === 'RETRYING' && (
                <AppText variant="label" tone="muted" testID="inbox-ai-retrying">
                  {t('office.inbox.readingRetrying')}
                </AppText>
              )}
              {detail.ai.status === 'FAILED' && detail.ai.failureMessage && (
                <AppText variant="label" tone="danger">
                  {detail.ai.failureMessage}
                </AppText>
              )}

              {reading?.summary && (
                <Card style={modalStyles.aiCard} testID="inbox-ai-summary">
                  <AppText variant="label" tone="muted" style={modalStyles.sectionLabel}>
                    {t('office.inbox.reading')}
                  </AppText>
                  <AppText style={{ marginTop: 4 }}>{reading.summary}</AppText>
                  {reading.confidence !== null && reading.confidence !== undefined && (
                    <AppText variant="label" tone="muted" style={{ marginTop: 4 }}>
                      {t('office.inbox.confidence', { percent: Math.round(reading.confidence * 100) })}
                    </AppText>
                  )}
                </Card>
              )}

              <Card style={{ padding: spacing.md }}>
                <AppText variant="label" tone="muted" style={modalStyles.sectionLabel}>
                  {t('office.inbox.message')}
                </AppText>
                <AppText style={{ marginTop: 6, lineHeight: 20 }}>{detail.bodyText?.trim() || t('office.inbox.noBody')}</AppText>
              </Card>

              {detail.attachments.length > 0 && (
                <View style={{ gap: spacing.xs }}>
                  <AppText variant="label" tone="muted" style={modalStyles.sectionLabel}>
                    {t('office.inbox.attachments', { count: detail.attachments.length })}
                  </AppText>
                  {detail.attachments.map((att) => (
                    <Card key={att.id} style={{ padding: spacing.sm }}>
                      <AppText style={{ fontWeight: '600' }} numberOfLines={1}>
                        📎 {att.filename}
                      </AppText>
                      <AppText variant="label" tone={att.stored ? 'muted' : 'danger'}>
                        {att.stored
                          ? `${att.mimeType} · ${Math.max(1, Math.round(att.sizeBytes / 1024))} KB`
                          : SKIP_REASONS.has(att.skipReason ?? '')
                            ? t(`office.inbox.skip.${att.skipReason}`)
                            : t('office.inbox.notStored')}
                      </AppText>
                    </Card>
                  ))}
                </View>
              )}

              <View style={officeStyles.row}>
                {detail.status === 'UNREAD' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSetStatus('READ')}
                    disabled={updating}
                    style={[modalStyles.statusBtn, { backgroundColor: colors.primary }]}
                  >
                    <AppText tone="inverse" style={{ fontWeight: '700' }}>{t('office.inbox.markRead')}</AppText>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSetStatus('UNREAD')}
                    disabled={updating}
                    style={[modalStyles.statusBtn, modalStyles.statusBtnOutline]}
                  >
                    <AppText style={{ fontWeight: '700' }}>{t('office.inbox.markUnread')}</AppText>
                  </Pressable>
                )}

                {detail.status !== 'ARCHIVED' && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSetStatus('ARCHIVED')}
                    disabled={updating}
                    style={[modalStyles.statusBtn, modalStyles.statusBtnOutline]}
                  >
                    <AppText style={{ fontWeight: '700' }}>{t('office.inbox.archive')}</AppText>
                  </Pressable>
                )}
              </View>
              {updateFailed && (
                <AppText variant="label" tone="danger" testID="inbox-status-error">
                  {t('office.inbox.statusFailed')}
                </AppText>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function OfficeInboxBody() {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const token = useSession((s) => s.token);
  const role = useSession((s) => s.role);
  const maySync = Boolean(role && MAY_SYNC.has(role));
  const [syncMessage, setSyncMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [status, setStatus] = useState<InboxStatusFilter>('');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query.trim());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const mailboxStatus = useOfficeData(officeApi.inboxStatus);

  const list = usePagedList(
    (tok, cursor) =>
      officeApi.inboxMessages(tok, {
        q: debouncedQuery || undefined,
        status: status || undefined,
        limit: 25,
        cursor,
      }),
    [debouncedQuery, status],
  );

  const handleSync = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const outcome = await officeApi.inboxSync(token);
      // What actually happened, never a bare "done": a sync that reached nothing says so.
      setSyncMessage(
        !outcome.ok
          ? { ok: false, text: outcome.reason ?? t('office.inbox.syncFailed') }
          : outcome.created > 0
            ? { ok: true, text: t('office.inbox.syncFiled', { count: outcome.created }) }
            : { ok: true, text: t('office.inbox.syncNothingNew') },
      );
      await Promise.all([list.reload(), mailboxStatus.reload()]);
    } catch {
      setSyncMessage({ ok: false, text: t('office.inbox.syncFailed') });
    } finally {
      setSyncing(false);
    }
  };

  const notConnected = mailboxStatus.data?.configured === false;

  return (
    <OfficeScreen
      title={t('office.nav.inbox')}
      subtitle={
        mailboxStatus.data?.configured && mailboxStatus.data.mailbox
          ? t('office.inbox.connectedAs', { mailbox: mailboxStatus.data.mailbox })
          : notConnected
            ? mailboxStatus.data?.unavailableReason ?? t('office.inbox.notConnected')
            : undefined
      }
      onRefresh={() => void Promise.all([list.reload(), mailboxStatus.reload()])}
      refreshing={list.refreshing}
      testID="office-inbox"
    >
      {/* Only for the roles the API lets contact the mailbox. */}
      {maySync && (
        <View style={officeStyles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: syncing || notConnected }}
            onPress={() => void handleSync()}
            disabled={syncing || notConnected}
            style={[inboxStyles.syncBtn, notConnected && { opacity: 0.5 }]}
            testID="inbox-check-now"
          >
            <AppText tone="inverse" style={{ fontWeight: '700' }}>
              {syncing ? t('office.inbox.checking') : t('office.inbox.checkNow')}
            </AppText>
          </Pressable>
        </View>
      )}
      {syncMessage && (
        <AppText variant="label" tone={syncMessage.ok ? 'muted' : 'danger'} testID="inbox-sync-message">
          {syncMessage.text}
        </AppText>
      )}
      {mailboxStatus.data?.configured && mailboxStatus.data.lastError ? (
        <AppText variant="label" tone="danger" testID="inbox-last-error">
          {t('office.inbox.lastCheckFailed', { reason: mailboxStatus.data.lastError })}
        </AppText>
      ) : null}

      <TextInput
        style={officeStyles.search}
        value={query}
        onChangeText={setQuery}
        placeholder={t('office.inbox.search')}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        accessibilityLabel={t('office.inbox.search')}
        testID="inbox-search-input"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={inboxStyles.filterRow}>
        {STATUS_FILTERS.map((key) => (
          <Pressable
            key={key || 'all'}
            accessibilityRole="button"
            accessibilityState={{ selected: status === key }}
            onPress={() => setStatus(key)}
            style={[inboxStyles.filterChip, status === key && inboxStyles.filterChipActive]}
            testID={`inbox-filter-${key || 'all'}`}
          >
            <AppText variant="label" style={[inboxStyles.filterText, status === key && inboxStyles.filterTextActive]}>
              {key ? t(`office.inbox.status.${key}`) : t('office.inbox.all')}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      {list.error && <LoadError error={list.error} onRetry={() => void list.reload()} />}
      {list.loading ? (
        <Loading />
      ) : list.rows.length === 0 && !list.error ? (
        <EmptyView title={query || status ? t('office.inbox.emptyMatching') : notConnected ? t('office.inbox.notConnected') : t('office.inbox.empty')} />
      ) : (
        list.rows.map((msg: OfficeInboxMessage) => {
          const isUnread = msg.status === 'UNREAD';
          return (
            <Pressable
              key={msg.id}
              accessibilityRole="button"
              onPress={() => setSelectedId(msg.id)}
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              testID={`inbox-message-${msg.id}`}
            >
              <Card style={[inboxStyles.messageCard, isUnread && inboxStyles.unreadCard]}>
                <View style={officeStyles.row}>
                  <View style={officeStyles.grow}>
                    <View style={officeStyles.row}>
                      <AppText style={[inboxStyles.subjectText, isUnread && { fontWeight: '700' }]} numberOfLines={1}>
                        {msg.subject || t('office.inbox.noSubject')}
                      </AppText>
                      {isUnread && <Pill label={t('office.inbox.new')} tone="success" />}
                    </View>

                    <AppText variant="label" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
                      {msg.from.name ? `${msg.from.name} · ` : ''}
                      {msg.from.address}
                    </AppText>

                    {msg.aiSummary && (
                      <AppText variant="label" numberOfLines={2} style={inboxStyles.aiSummaryText}>
                        {msg.aiSummary}
                      </AppText>
                    )}

                    <View style={[officeStyles.row, { marginTop: 6, justifyContent: 'space-between' }]}>
                      <Pill label={categoryLabel(msg.classification)} tone={classificationTone(msg.classification)} />
                      <View style={officeStyles.row}>
                        {msg.attachmentCount > 0 && (
                          <AppText variant="label" tone="muted">
                            📎 {msg.attachmentCount} ·{' '}
                          </AppText>
                        )}
                        <AppText variant="label" tone="muted">
                          {relativeTime(msg.receivedAt, t)}
                        </AppText>
                      </View>
                    </View>
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })
      )}

      <ShowMore list={list} />

      <MessageDetailModal
        messageId={selectedId}
        onClose={() => setSelectedId(null)}
        onStatusChanged={() => {
          void list.reload();
        }}
      />
    </OfficeScreen>
  );
}

export default function OfficeInbox() {
  return (
    <ModuleGuard module="inbox">
      <OfficeInboxBody />
    </ModuleGuard>
  );
}

const inboxStyles = StyleSheet.create({
  syncBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  filterChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontWeight: '700',
    color: colors.mutedForeground,
  },
  filterTextActive: {
    color: colors.primaryForeground,
  },
  messageCard: {
    gap: 4,
  },
  unreadCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  subjectText: {
    fontSize: 15,
    flex: 1,
  },
  aiSummaryText: {
    color: colors.foreground,
    marginTop: 4,
    opacity: 0.85,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  retry: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  aiCard: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusBtn: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  statusBtnOutline: {
    borderColor: colors.border,
    borderWidth: 1,
  },
});
