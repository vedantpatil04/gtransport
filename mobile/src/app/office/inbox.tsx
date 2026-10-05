import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { AppText, Card, EmptyView, Loading } from '../../components/ui';
import {
  DASH,
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
import {
  officeApi,
  type OfficeInboxDetail,
  type OfficeInboxMessage,
} from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

type InboxStatusFilter = '' | 'UNREAD' | 'READ' | 'ARCHIVED';

const STATUS_FILTERS: { key: InboxStatusFilter; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'UNREAD', label: 'Unread' },
  { key: 'READ', label: 'Read' },
  { key: 'ARCHIVED', label: 'Archived' },
];

function relTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${Math.max(1, secs)}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The office's categories (see the API's InboxClassification), as the pill reads them. */
const CATEGORY_LABEL: Record<string, string> = {
  VEHICLE_DOCUMENT: 'Vehicle papers',
  FUEL: 'Fuel',
  MAINTENANCE: 'Maintenance',
  FINANCE: 'Finance',
  SALARY_PAYMENT: 'Salary / payment',
  COMPLIANCE: 'Compliance',
  VENDOR: 'Vendor',
  CUSTOMER: 'Customer',
  GENERAL: 'General',
  SPAM: 'Junk',
  UNCLASSIFIED: 'Not sorted',
};

const categoryLabel = (category: string) => CATEGORY_LABEL[category] ?? category.replace(/_/g, ' ');

function classificationTone(
  category: string,
): 'default' | 'success' | 'warning' | 'danger' {
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

/** Why an attachment was not kept. Something arrived; the office should know why it is not here. */
const SKIP_REASON: Record<string, string> = {
  suspicious_extension: 'Refused: this kind of file is not accepted',
  unsupported_type: 'Refused: not a document or photo',
  too_large: 'Refused: larger than the office keeps',
  empty: 'Refused: the file was empty',
  download_failed: 'Not saved yet: the download failed and will be retried',
};

/** Contacting the mailbox is a fleet-management act on the API; other roles only read. */
const MAY_SYNC = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER']);

/** Detail modal for one message */
function MessageDetailModal({
  messageId,
  onClose,
  onStatusChanged,
}: {
  messageId: string | null;
  onClose: () => void;
  onStatusChanged: () => void;
}) {
  const token = useSession((s) => s.token);
  const [detail, setDetail] = useState<OfficeInboxDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!messageId || !token) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const data = await officeApi.inboxMessage(token, messageId);
      setDetail(data);
    } catch {
      setDetail(null);
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
    try {
      await officeApi.inboxSetStatus(token, detail.id, nextStatus);
      setDetail((prev) => (prev ? { ...prev, status: nextStatus } : null));
      onStatusChanged();
    } catch {
      // Ignored
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Modal visible={Boolean(messageId)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet} testID="inbox-message-detail">
          {/* Header */}
          <View style={modalStyles.headerRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="h2" numberOfLines={2}>
                {detail?.subject ?? 'Message Details'}
              </AppText>
              {detail && (
                <AppText variant="label" tone="muted">
                  {detail.from.name ? `${detail.from.name} · ` : ''}
                  {detail.from.address} · {relTime(detail.receivedAt)}
                </AppText>
              )}
            </View>
            <Pressable onPress={onClose} style={modalStyles.closeBtn} accessibilityLabel="Close">
              <AppText variant="h2" tone="muted">✕</AppText>
            </Pressable>
          </View>

          {loading ? (
            <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
              <Loading />
            </View>
          ) : !detail ? (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <AppText tone="muted">Could not load message details.</AppText>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm }}>
              {/* Category Pill */}
              <View style={officeStyles.row}>
                <Pill label={categoryLabel(detail.classification)} tone={classificationTone(detail.classification)} />
                <Pill label={detail.status} />
              </View>

              {detail.ai.status === 'RETRYING' && (
                <AppText variant="label" tone="muted" testID="inbox-ai-retrying">
                  Reading this mail failed; it will be tried again automatically.
                </AppText>
              )}
              {detail.ai.status === 'FAILED' && detail.ai.failureMessage && (
                <AppText variant="label" tone="danger">
                  {detail.ai.failureMessage}
                </AppText>
              )}

              {/* AI Reading Summary */}
              {detail.aiResults && detail.aiResults.length > 0 && detail.aiResults[0]?.summary && (
                <Card style={modalStyles.aiCard} testID="inbox-ai-summary">
                  <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    ✨ AI Reading
                  </AppText>
                  <AppText style={{ marginTop: 4 }}>{detail.aiResults[0].summary}</AppText>
                  {detail.aiResults[0].confidence !== null && detail.aiResults[0].confidence !== undefined && (
                    <AppText variant="label" tone="muted" style={{ marginTop: 4 }}>
                      Confidence: {Math.round(detail.aiResults[0].confidence * 100)}%
                    </AppText>
                  )}
                </Card>
              )}

              {/* Message Body */}
              <Card style={{ padding: spacing.md }}>
                <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Message Content
                </AppText>
                <AppText style={{ marginTop: 6, lineHeight: 20 }}>
                  {detail.bodyText ? detail.bodyText.trim() : '(No message body)'}
                </AppText>
              </Card>

              {/* Attachments */}
              {detail.attachments.length > 0 && (
                <View style={{ gap: spacing.xs }}>
                  <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    Attachments ({detail.attachments.length})
                  </AppText>
                  {detail.attachments.map((att) => (
                    <Card key={att.id} style={{ padding: spacing.sm }}>
                      <AppText style={{ fontWeight: '600' }} numberOfLines={1}>
                        📎 {att.filename}
                      </AppText>
                      <AppText variant="label" tone={att.stored ? 'muted' : 'danger'}>
                        {att.stored
                          ? `${att.mimeType} · ${Math.max(1, Math.round(att.sizeBytes / 1024))} KB`
                          : (SKIP_REASON[att.skipReason ?? ''] ?? 'Not stored')}
                      </AppText>
                    </Card>
                  ))}
                </View>
              )}

              {/* Status Actions */}
              <View style={officeStyles.row}>
                {detail.status === 'UNREAD' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSetStatus('READ')}
                    disabled={updating}
                    style={[modalStyles.statusBtn, { backgroundColor: colors.primary }]}
                  >
                    <AppText tone="inverse" style={{ fontWeight: '700' }}>Mark Read</AppText>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSetStatus('UNREAD')}
                    disabled={updating}
                    style={[modalStyles.statusBtn, { borderColor: colors.border, borderWidth: 1 }]}
                  >
                    <AppText style={{ fontWeight: '700' }}>Mark Unread</AppText>
                  </Pressable>
                )}

                {detail.status !== 'ARCHIVED' && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSetStatus('ARCHIVED')}
                    disabled={updating}
                    style={[modalStyles.statusBtn, { borderColor: colors.border, borderWidth: 1 }]}
                  >
                    <AppText style={{ fontWeight: '700' }}>Archive</AppText>
                  </Pressable>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function OfficeInboxBody() {
  const { t } = useTranslation();
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
          ? { ok: false, text: outcome.reason ?? 'The mailbox could not be checked.' }
          : outcome.created > 0
            ? { ok: true, text: `Filed ${outcome.created} new message(s).` }
            : { ok: true, text: 'Nothing new.' },
      );
      await Promise.all([list.reload(), mailboxStatus.reload()]);
    } catch {
      setSyncMessage({ ok: false, text: 'The mailbox could not be checked. Try again shortly.' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <OfficeScreen
      title={t('office.nav.inbox', { defaultValue: 'Inbox' })}
      subtitle={
        mailboxStatus.data?.configured && mailboxStatus.data.mailbox
          ? `Connected: ${mailboxStatus.data.mailbox}`
          : mailboxStatus.data?.configured === false
            ? (mailboxStatus.data.unavailableReason ?? 'Mailbox not connected')
            : undefined
      }
      onRefresh={() => void Promise.all([list.reload(), mailboxStatus.reload()])}
      refreshing={list.refreshing}
      testID="office-inbox"
    >
      {/* Sync / Check Now Button — only for the roles the API lets contact the mailbox */}
      {maySync && (
        <View style={officeStyles.row}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleSync()}
            disabled={syncing || mailboxStatus.data?.configured === false}
            style={[inboxStyles.syncBtn, mailboxStatus.data?.configured === false && { opacity: 0.5 }]}
            testID="inbox-check-now"
          >
            <AppText tone="inverse" style={{ fontWeight: '700' }}>
              {syncing ? 'Checking Mailbox…' : '🔄 Check Now'}
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
          Last check failed: {mailboxStatus.data.lastError}
        </AppText>
      ) : null}

      {/* Search Input */}
      <TextInput
        style={officeStyles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search subject or sender"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        accessibilityLabel="Search inbox"
        testID="inbox-search-input"
      />

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={inboxStyles.filterRow}>
        {STATUS_FILTERS.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => setStatus(item.key)}
            style={[inboxStyles.filterChip, status === item.key && inboxStyles.filterChipActive]}
            testID={`inbox-filter-${item.key || 'all'}`}
          >
            <AppText
              variant="label"
              style={[inboxStyles.filterText, status === item.key && inboxStyles.filterTextActive]}
            >
              {item.label}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      {/* Errors & Loading */}
      {list.error && <LoadError error={list.error} onRetry={() => void list.reload()} />}
      {list.loading ? (
        <Loading />
      ) : list.rows.length === 0 && !list.error ? (
        <EmptyView title={query ? 'No matching messages' : 'Inbox is empty'} />
      ) : (
        /* Messages List */
        list.rows.map((msg: OfficeInboxMessage) => {
          const tone = classificationTone(msg.classification);
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
                      <AppText
                        style={[inboxStyles.subjectText, isUnread && { fontWeight: '700' }]}
                        numberOfLines={1}
                      >
                        {msg.subject || '(No subject)'}
                      </AppText>
                      {isUnread && <Pill label="NEW" tone="success" />}
                    </View>

                    <AppText variant="label" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
                      {msg.from.name ? `${msg.from.name} · ` : ''}
                      {msg.from.address}
                    </AppText>

                    {msg.aiSummary && (
                      <AppText variant="label" numberOfLines={2} style={inboxStyles.aiSummaryText}>
                        ✨ {msg.aiSummary}
                      </AppText>
                    )}

                    <View style={[officeStyles.row, { marginTop: 6, justifyContent: 'space-between' }]}>
                      <Pill label={categoryLabel(msg.classification)} tone={tone} />
                      <View style={officeStyles.row}>
                        {msg.attachmentCount > 0 && (
                          <AppText variant="label" tone="muted">
                            📎 {msg.attachmentCount} ·{' '}
                          </AppText>
                        )}
                        <AppText variant="label" tone="muted">
                          {relTime(msg.receivedAt)}
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

      {/* Message Detail Modal */}
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
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET - 4,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
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
    fontSize: 12,
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
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  aiCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  statusBtn: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
});
