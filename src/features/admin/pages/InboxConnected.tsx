import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Archive, Ban, Check, Download, Inbox, Lightbulb, Link2, Link2Off, MailOpen, Paperclip, RefreshCw,
  ShieldQuestion, Sparkles, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { fetchInboxAttachment, inboxApi, vehiclesApi } from '@/features/api/resources';
import { canAdministerAccounts, canManageFinance, canManageFleet, useSession, type ApiRole } from '@/features/api/session';
import type {
  ApiInboxClassification, ApiInboxMessage, ApiInboxStatus, ApiInboxStatusInfo, ApiInboxSuggestion, ApiSuggestionType,
} from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { fmtDateTime } from '@/lib/format';
import { relTime } from '@/lib/relative';
import { cn } from '@/lib/utils';
import { FilterBar, PageHeader, Panel, SearchInput, StatCard } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

/**
 * The company mailbox, as the office reads it.
 *
 * Three things this screen is careful about. A category set by a person and a category suggested
 * by a model look different, because they are different: the first is a decision, the second is a
 * guess that the office is free to overrule — and once they do, no later run changes it back. An
 * attachment that was refused on the way in is still shown, with the reason, so "nothing arrived"
 * and "something arrived and we would not keep it" can never be confused. And a follow-up the
 * model suggests is only ever a suggestion: nothing happens until someone with the right role
 * accepts it, and the only record acceptance can create is a service record that still has to be
 * verified like any other.
 *
 * Nothing on this screen sends, replies to, forwards or deletes anything. The server offers no way
 * to, and the mailbox is connected with read-only access.
 */

const CLASSIFICATIONS: ApiInboxClassification[] = [
  'UNCLASSIFIED', 'VEHICLE_DOCUMENT', 'FUEL', 'MAINTENANCE', 'FINANCE', 'SALARY_PAYMENT',
  'COMPLIANCE', 'VENDOR', 'CUSTOMER', 'GENERAL', 'SPAM',
];

const CLASSIFICATION_TONE: Record<ApiInboxClassification, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  UNCLASSIFIED: 'neutral',
  VEHICLE_DOCUMENT: 'info',
  FUEL: 'info',
  MAINTENANCE: 'info',
  FINANCE: 'success',
  SALARY_PAYMENT: 'success',
  COMPLIANCE: 'warning',
  VENDOR: 'neutral',
  CUSTOMER: 'neutral',
  GENERAL: 'neutral',
  SPAM: 'danger',
};

/** Mirrors the server's rule — each kind is decided by the roles that act in that area. UX only. */
function mayDecide(role: ApiRole | undefined, type: ApiSuggestionType): boolean {
  switch (type) {
    case 'CREATE_SERVICE_RECORD':
    case 'RECORD_FUEL_EXPENSE':
      return canManageFleet(role) || canManageFinance(role);
    case 'REVIEW_VEHICLE_DOCUMENT':
    case 'REVIEW_COMPLIANCE':
      return canManageFleet(role);
    case 'REVIEW_FINANCE':
    case 'REVIEW_PAYMENT':
      return canManageFinance(role);
  }
}

export function InboxConnected() {
  const { t, i18n } = useTranslation();
  const role = useSession((s) => s.user?.role);
  /** Contacting the mailbox and asking for a re-read are fleet-management acts. */
  const mayRun = canManageFleet(role);

  const [status, setStatus] = useState<ApiInboxStatus | ''>('');
  const [classification, setClassification] = useState<ApiInboxClassification | ''>('');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [params, setParams] = useSearchParams();

  const filters = { status: status || undefined, classification: classification || undefined, q: search || undefined };
  const mailbox = useApiResource(() => inboxApi.status(), []);
  const summary = useApiResource(() => inboxApi.summary(), []);
  const messages = useApiResource(() => inboxApi.list({ ...filters, limit: 50 }), [JSON.stringify(filters)]);

  // Back from the provider's consent screen: say what happened, once, and tidy the address bar.
  useEffect(() => {
    const outcome = params.get('mailbox');
    if (!outcome) return;
    if (outcome === 'connected') toast.success(t('admin.inboxLive.connectedToast'));
    else toast.error(t('admin.inboxLive.connectFailed', { reason: params.get('reason') ?? 'unknown' }));
    const next = new URLSearchParams(params);
    next.delete('mailbox');
    next.delete('reason');
    setParams(next, { replace: true });
  }, [params, setParams, t]);

  const reloadAll = () => {
    messages.reload();
    summary.reload();
    mailbox.reload();
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const outcome = await inboxApi.sync();
      // Reported as what actually happened. "Synced" must never be able to mean "reached nothing".
      if (!outcome.ok) toast.error(outcome.reason ?? t('admin.inboxLive.syncFailed'));
      else if (outcome.created === 0) toast.success(t('admin.inboxLive.syncNothingNew', { fetched: outcome.fetched }));
      else toast.success(t('admin.inboxLive.syncFiled', { count: outcome.created }));
      for (const notice of outcome.notices ?? []) toast.info(notice);
      reloadAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    } finally {
      setSyncing(false);
    }
  };

  const info = mailbox.data;
  const rows = messages.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('admin.inboxLive.title')}
        description={t('admin.inboxLive.subtitle')}
        actions={
          mayRun && (
            <Button variant="outline" disabled={syncing || info?.configured === false} onClick={() => void runSync()}>
              <RefreshCw className={cn(syncing && 'animate-spin')} />
              {t('admin.inboxLive.checkNow')}
            </Button>
          )
        }
      />

      {info && <ConnectionPanel info={info} onChanged={reloadAll} />}

      {info?.configured && info.lastError && (
        <div className="panel mt-3 flex items-start gap-3 border-danger/40 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-semibold text-danger">{t('admin.inboxLive.lastSyncFailed')}</p>
            <p className="mt-1 text-sm text-foreground/80">{info.lastError}</p>
            {info.consecutiveFailures > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('admin.inboxLive.consecutiveFailures', { count: info.consecutiveFailures })}
              </p>
            )}
            {info.nextAttemptAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('admin.inboxLive.nextRetry', { when: fmtDateTime(info.nextAttemptAt, i18n.language) })}
              </p>
            )}
          </div>
        </div>
      )}

      {info?.configured && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={t('admin.inboxLive.unread')} value={String(summary.data?.unread ?? 0)} icon={Inbox} />
          <StatCard
            label={t('admin.inboxLive.needsAttention')}
            value={String(summary.data?.needingAttention ?? 0)}
            icon={AlertTriangle}
            sub={t('admin.inboxLive.needsAttentionSub')}
          />
          <StatCard
            label={t('admin.inboxLive.suggestionsToDecide')}
            value={String(summary.data?.pendingSuggestions ?? 0)}
            icon={Lightbulb}
            sub={
              info.lastSyncFinishedAt
                ? t('admin.inboxLive.lastChecked', { when: relTime(info.lastSyncFinishedAt, i18n.language) })
                : t('admin.inboxLive.neverChecked')
            }
          />
        </div>
      )}

      <Panel className="mt-6" title={t('admin.inboxLive.messages')}>
        <FilterBar
          active={Boolean(status || classification || q)}
          onClear={() => {
            setStatus('');
            setClassification('');
            setQ('');
          }}
        >
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.inboxLive.search')} className="w-full sm:w-72" />
          <NativeSelect
            value={status}
            onChange={(event) => setStatus(event.target.value as ApiInboxStatus | '')}
            className="w-auto min-w-[130px]"
            aria-label={t('admin.common.status')}
          >
            <option value="">{t('admin.inboxLive.allStatuses')}</option>
            <option value="UNREAD">{t('admin.inboxLive.status.UNREAD')}</option>
            <option value="READ">{t('admin.inboxLive.status.READ')}</option>
            <option value="ARCHIVED">{t('admin.inboxLive.status.ARCHIVED')}</option>
          </NativeSelect>
          <NativeSelect
            value={classification}
            onChange={(event) => setClassification(event.target.value as ApiInboxClassification | '')}
            className="w-auto min-w-[170px]"
            aria-label={t('admin.inboxLive.category')}
          >
            <option value="">{t('admin.inboxLive.allCategories')}</option>
            {CLASSIFICATIONS.map((key) => (
              <option key={key} value={key}>
                {t(`admin.inboxLive.class.${key}`)}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>

        {messages.loading ? (
          <TableLoading rows={6} columns={3} />
        ) : messages.error ? (
          <ErrorState error={messages.error} onRetry={messages.reload} />
        ) : rows.length === 0 ? (
          <p className="flex flex-col items-center gap-2 px-4 py-16 text-center text-sm text-muted-foreground">
            <Inbox className="size-8 opacity-40" />
            {info?.configured ? t('admin.inboxLive.empty') : t('admin.inboxLive.emptyNotConfigured')}
          </p>
        ) : (
          <ul className="divide-y" data-testid="inbox-live-list">
            {rows.map((row) => (
              <li key={row.id} className={cn('transition-colors hover:bg-accent/40', row.status === 'UNREAD' && 'bg-primary/[0.03]')}>
                <button type="button" onClick={() => setOpenId(row.id)} className="flex w-full items-start gap-3 p-4 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn('truncate text-sm', row.status === 'UNREAD' ? 'font-semibold' : 'font-medium text-foreground/90')}>
                        {row.subject ?? t('admin.inboxLive.noSubject')}
                      </span>
                      <Badge tone={CLASSIFICATION_TONE[row.classification]}>
                        {t(`admin.inboxLive.class.${row.classification}`)}
                      </Badge>
                      {/* The distinction that matters: a decision, or still only a suggestion. */}
                      {row.classificationConfirmed ? (
                        <Badge tone="success" className="text-[10px] uppercase tracking-wider">
                          <Check />
                          {t('admin.inboxLive.setByOffice')}
                        </Badge>
                      ) : row.classification !== 'UNCLASSIFIED' ? (
                        <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
                          <Sparkles />
                          {t('admin.inboxLive.suggested')}
                        </Badge>
                      ) : null}
                      {row.pendingSuggestions > 0 && (
                        <Badge tone="warning" className="text-[10px]">
                          <Lightbulb />
                          {row.pendingSuggestions}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {row.from.name ? `${row.from.name} · ` : ''}
                      {row.from.address}
                    </span>
                    {row.aiSummary && <span className="mt-1 block line-clamp-2 text-xs text-foreground/70">{row.aiSummary}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-muted-foreground" title={fmtDateTime(row.receivedAt, i18n.language)}>
                      {relTime(row.receivedAt, i18n.language)}
                    </span>
                    {row.attachmentCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Paperclip className="size-3" />
                        {row.attachmentCount}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <MessageDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} mayRun={mayRun} />
    </div>
  );
}

/**
 * Which mailbox is connected, by what means, and whether it is healthy.
 *
 * Gmail and Microsoft 365 are connected from here through the provider's own consent screen; an
 * IMAP mailbox is set on the server. "Not connected" and "needs connecting again" are stated as
 * such — neither is ever shown as an empty inbox.
 */
function ConnectionPanel({ info, onChanged }: { info: ApiInboxStatusInfo; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const role = useSession((s) => s.user?.role);
  const isAdmin = canAdministerAccounts(role);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { connection } = info;
  const current = connection.connection;
  const providerLabel = connection.provider ? t(`admin.inboxLive.provider.${connection.provider}`) : '—';

  const connect = async () => {
    setBusy(true);
    try {
      const { authorizationUrl } = await inboxApi.authorize();
      // The provider's consent screen; it sends the browser back to this page afterwards.
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await inboxApi.disconnect();
      toast.success(t('admin.inboxLive.disconnectedToast'));
      setConfirmDisconnect(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (connection.mode === 'none') {
    return (
      <div className="panel flex items-start gap-3 p-4">
        <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold">{t('admin.inboxLive.notConfiguredTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.inboxLive.notConfiguredBody')}</p>
        </div>
      </div>
    );
  }

  const state = connection.mode === 'imap' ? 'CONNECTED' : (current?.status ?? 'NOT_CONNECTED');
  const tone = state === 'CONNECTED' ? 'success' : state === 'REAUTHORIZATION_REQUIRED' ? 'danger' : 'neutral';

  return (
    <div className="panel p-4" data-testid="mailbox-connection">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {t('admin.inboxLive.connectionTitle')}
            <Badge tone={tone}>{t(`admin.inboxLive.connection.${state}`)}</Badge>
            <span className="text-xs font-normal text-muted-foreground">{providerLabel}</span>
          </p>
          {connection.mode === 'imap' ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('admin.inboxLive.imapConfigured', { mailbox: info.mailbox ?? '—' })}</p>
          ) : current?.status === 'CONNECTED' ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.inboxLive.connectedAs', { address: current.emailAddress ?? '—' })}
              {current.connectedAt ? ` · ${t('admin.inboxLive.connectedSince', { when: fmtDateTime(current.connectedAt, i18n.language) })}` : ''}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{info.unavailableReason ?? t('admin.inboxLive.notConnectedBody')}</p>
          )}
          {current?.lastError && current.status !== 'CONNECTED' && current.status !== 'REAUTHORIZATION_REQUIRED' && (
            <p className="mt-1 text-xs text-danger">{current.lastError}</p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t('admin.inboxLive.readOnlyNote')}</p>
        </div>

        {connection.canConnect && isAdmin && (
          <div className="flex flex-wrap gap-2">
            {current?.status === 'CONNECTED' ? (
              confirmDisconnect ? (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>
                    <Link2Off />
                    {t('admin.inboxLive.disconnectConfirm')}
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
                  <Link2Off />
                  {t('admin.inboxLive.disconnect')}
                </Button>
              )
            ) : (
              <Button disabled={busy} onClick={() => void connect()}>
                <Link2 />
                {current && current.status !== 'PENDING'
                  ? t('admin.inboxLive.reconnect')
                  : t('admin.inboxLive.connect', { provider: providerLabel })}
              </Button>
            )}
          </div>
        )}
      </div>
      {confirmDisconnect && <p className="mt-2 text-xs text-muted-foreground">{t('admin.inboxLive.disconnectWarning')}</p>}
    </div>
  );
}

/** One message in full: the text, what arrived with it, what the office decides it is, and what to do. */
function MessageDrawer({
  id,
  onClose,
  onChanged,
  mayRun,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
  mayRun: boolean;
}) {
  const { t, i18n } = useTranslation();
  const message = useApiResource(() => inboxApi.get(id as string), [id], Boolean(id));
  const data = message.data;
  const [busy, setBusy] = useState(false);

  const fail = (error: unknown) => toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
  const refresh = () => {
    message.reload();
    onChanged();
  };

  const setClassification = async (next: ApiInboxClassification) => {
    if (!data) return;
    setBusy(true);
    try {
      await inboxApi.classify(data.id, next);
      toast.success(t('admin.inboxLive.categorySet'));
      refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (next: ApiInboxStatus) => {
    if (!data) return;
    setBusy(true);
    try {
      await inboxApi.setStatus(data.id, next);
      refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const readAgain = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const outcome = await inboxApi.retryAI(data.id);
      // An unapplied result is not a failure: a person had already decided, or the model was unsure.
      toast.success(outcome.applied ? t('admin.inboxLive.reread') : t('admin.inboxLive.rereadNotApplied'));
      refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const download = async (attachmentId: string) => {
    if (!data) return;
    try {
      const file = await fetchInboxAttachment(data.id, attachmentId);
      const link = document.createElement('a');
      link.href = file.url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(file.url);
    } catch {
      toast.error(t('admin.inboxLive.attachmentFailed'));
    }
  };

  const pending = data?.suggestions.filter((s) => s.status === 'PENDING') ?? [];
  const decided = data?.suggestions.filter((s) => s.status === 'ACCEPTED' || s.status === 'REJECTED') ?? [];

  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full max-w-xl p-0 sm:max-w-xl">
        <div className="border-b px-4 py-3.5 pr-12">
          <SheetTitle>{data?.subject ?? t('admin.inboxLive.noSubject')}</SheetTitle>
          {data && (
            <p className="mt-1 text-xs text-muted-foreground">
              {data.from.name ? `${data.from.name} · ` : ''}
              {data.from.address} · {fmtDateTime(data.receivedAt, i18n.language)}
            </p>
          )}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {message.loading ? (
            <TableLoading rows={4} columns={1} />
          ) : message.error ? (
            <ErrorState error={message.error} onRetry={message.reload} />
          ) : !data ? null : (
            <div className="space-y-5 p-4">
              <section>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.inboxLive.category')}</p>
                  {data.classificationConfirmed ? (
                    <span className="text-[11px] text-success">
                      {t('admin.inboxLive.setByOfficeAt', { when: data.classifiedAt ? fmtDateTime(data.classifiedAt, i18n.language) : '—' })}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{t('admin.inboxLive.notYetDecided')}</span>
                  )}
                </div>
                <NativeSelect
                  className="mt-1.5"
                  value={data.classification}
                  disabled={busy}
                  onChange={(event) => void setClassification(event.target.value as ApiInboxClassification)}
                  aria-label={t('admin.inboxLive.category')}
                >
                  {CLASSIFICATIONS.map((key) => (
                    <option key={key} value={key}>
                      {t(`admin.inboxLive.class.${key}`)}
                    </option>
                  ))}
                </NativeSelect>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t('admin.inboxLive.categoryNote')}</p>
              </section>

              {data.aiResults.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.inboxLive.reading')}</p>
                  <div className="mt-1.5 rounded-lg border p-3">
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="mt-px size-3.5 shrink-0" />
                      {t('admin.inboxLive.readingNote')}
                    </p>
                    <p className="mt-2 text-sm text-foreground/85">{data.aiResults[0].summary ?? '—'}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {t('admin.inboxLive.readingMeta', {
                        version: data.aiResults[0].version,
                        model: data.aiResults[0].model,
                        confidence:
                          data.aiResults[0].confidence === null ? '—' : `${Math.round(data.aiResults[0].confidence * 100)}%`,
                      })}
                      {' · '}
                      {t(`admin.inboxLive.class.${data.aiResults[0].classification}`)}
                    </p>
                    {data.aiResults[0].warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {data.aiResults[0].warnings.map((warning) => (
                          <li key={warning} className="text-[11px] text-warning">
                            · {warning}
                          </li>
                        ))}
                      </ul>
                    )}
                    {data.aiResults[0].references.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {data.aiResults[0].references.map((reference, index) => (
                          <li key={`${reference.type}-${index}`}>
                            <Badge tone="neutral">
                              {reference.type}: {reference.value}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              {data.ai.status === 'RETRYING' && (
                <p className="rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-xs text-foreground/80">
                  {t('admin.inboxLive.readingRetrying', {
                    when: data.ai.nextAttemptAt ? fmtDateTime(data.ai.nextAttemptAt, i18n.language) : '—',
                  })}
                </p>
              )}
              {data.ai.status === 'FAILED' && (
                <p className="rounded-lg border border-danger/40 bg-danger-soft/50 p-3 text-xs text-foreground/80">
                  {data.ai.failureMessage ?? t('admin.inboxLive.readingFailed')}
                </p>
              )}

              {(pending.length > 0 || decided.length > 0) && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.inboxLive.suggestionsTitle')}</p>
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <Lightbulb className="mt-px size-3 shrink-0" />
                    {t('admin.inboxLive.suggestionNote')}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {pending.map((suggestion) => (
                      <li key={suggestion.id}>
                        <SuggestionCard suggestion={suggestion} message={data} onDecided={refresh} />
                      </li>
                    ))}
                    {decided.map((suggestion) => (
                      <li key={suggestion.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                        <span className="min-w-0 truncate">{t(`admin.inboxLive.suggestionType.${suggestion.type}`)}</span>
                        <Badge tone={suggestion.status === 'ACCEPTED' ? 'success' : 'neutral'}>
                          {t(`admin.inboxLive.suggestionStatus.${suggestion.status}`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.inboxLive.body')}</p>
                {/* Plain text, rendered as text. The server flattened any HTML on the way in. */}
                <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm text-foreground/85">
                  {data.bodyText ?? t('admin.inboxLive.noBody')}
                </pre>
                {data.bodyTruncated && <p className="mt-1 text-[11px] text-muted-foreground">{t('admin.inboxLive.bodyTruncated')}</p>}
                {data.hasHtml && <p className="mt-1 text-[11px] text-muted-foreground">{t('admin.inboxLive.htmlFlattened')}</p>}
              </section>

              {data.attachments.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.inboxLive.attachments')}</p>
                  <ul className="mt-1.5 divide-y rounded-lg border">
                    {data.attachments.map((attachment) => (
                      <li key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
                        {attachment.stored ? (
                          <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Ban className="size-4 shrink-0 text-danger" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{attachment.filename}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {attachment.stored
                              ? `${attachment.mimeType} · ${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB`
                              : /* Refused or not yet downloaded, and the reason is shown. */
                                t(`admin.inboxLive.skip.${attachment.skipReason ?? 'unsupported_type'}`)}
                          </span>
                        </span>
                        {attachment.stored && (
                          <Button variant="ghost" size="sm" onClick={() => void download(attachment.id)}>
                            <Download className="size-3.5" />
                            {t('admin.inboxLive.download')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.authenticationResults && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.inboxLive.authentication')}</p>
                  <p className="mt-1 break-words rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
                    {data.authenticationResults}
                  </p>
                </section>
              )}
            </div>
          )}
        </div>

        {data && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t p-3">
            {mayRun && (
              <Button variant="outline" disabled={busy} onClick={() => void readAgain()}>
                <RefreshCw className={cn(busy && 'animate-spin')} />
                {t('admin.inboxLive.readAgain')}
              </Button>
            )}
            {data.status !== 'ARCHIVED' && (
              <Button variant="outline" disabled={busy} onClick={() => void setStatus('ARCHIVED')}>
                <Archive />
                {t('admin.inboxLive.archive')}
              </Button>
            )}
            {data.status === 'UNREAD' ? (
              <Button disabled={busy} onClick={() => void setStatus('READ')}>
                <MailOpen />
                {t('admin.inboxLive.markRead')}
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => void setStatus('UNREAD')}>
                <Inbox />
                {t('admin.inboxLive.markUnread')}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * One pending suggestion, and the decision on it.
 *
 * For a workshop invoice, accepting needs the figures checked against the attached invoice — the
 * model's reading only pre-fills the form — and the service record it creates still goes through
 * Service AI review and verification. Every other kind of suggestion is accepted as "the office
 * will handle this"; no finance, payment or compliance record is created from here.
 */
function SuggestionCard({ suggestion, message, onDecided }: { suggestion: ApiInboxSuggestion; message: ApiInboxMessage; onDecided: () => void }) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role);
  const allowed = mayDecide(role, suggestion.type);
  const isService = suggestion.type === 'CREATE_SERVICE_RECORD';
  const [mode, setMode] = useState<'idle' | 'accept' | 'reject'>('idle');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), [], isService && mode === 'accept');
  const receipts = message.attachments.filter((a) => a.stored && (a.mimeType === 'application/pdf' || a.mimeType.startsWith('image/')));
  const [form, setForm] = useState({
    vehicleId: '',
    amount: suggestion.details.amount?.toFixed(2) ?? '',
    expenseDate: suggestion.details.date ?? '',
    vendorName: message.from.name ?? '',
    attachmentId: suggestion.attachment?.stored ? suggestion.attachment.id : (receipts[0]?.id ?? ''),
  });

  // The registration the model read, matched to a fleet vehicle only when it matches exactly.
  useEffect(() => {
    if (!vehicles.data || form.vehicleId || !suggestion.details.vehicleRegistration) return;
    const wanted = suggestion.details.vehicleRegistration.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const match = vehicles.data.data.find((v) => v.registrationNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase() === wanted);
    if (match) setForm((current) => ({ ...current, vehicleId: match.id }));
  }, [vehicles.data, form.vehicleId, suggestion.details.vehicleRegistration]);

  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      if (accept) {
        await inboxApi.acceptSuggestion(suggestion.id, {
          note: note.trim() || undefined,
          ...(isService
            ? {
                serviceRecord: {
                  vehicleId: form.vehicleId,
                  amount: Number(form.amount),
                  expenseDate: form.expenseDate,
                  vendorName: form.vendorName.trim() || undefined,
                  attachmentId: form.attachmentId || undefined,
                },
              }
            : {}),
        });
        toast.success(isService ? t('admin.inboxLive.serviceRecordCreated') : t('admin.inboxLive.suggestionAccepted'));
      } else {
        await inboxApi.rejectSuggestion(suggestion.id, note.trim() || undefined);
        toast.success(t('admin.inboxLive.suggestionRejected'));
      }
      onDecided();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const serviceReady = Boolean(form.vehicleId && Number(form.amount) > 0 && form.expenseDate && form.attachmentId);
  const facts = [
    suggestion.details.vehicleRegistration,
    suggestion.details.reference,
    suggestion.details.amount !== null ? `₹${suggestion.details.amount.toLocaleString('en-IN')}` : null,
    suggestion.details.date,
    suggestion.attachment?.filename,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t(`admin.inboxLive.suggestionType.${suggestion.type}`)}</p>
          {suggestion.reason && <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.reason}</p>}
          {facts.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{facts.join(' · ')}</p>}
        </div>
        {allowed && mode === 'idle' && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setMode('reject')}>
              <X className="size-3.5" />
              {t('admin.inboxLive.dismiss')}
            </Button>
            <Button size="sm" onClick={() => setMode('accept')}>
              <Check className="size-3.5" />
              {t('admin.inboxLive.accept')}
            </Button>
          </div>
        )}
      </div>
      {!allowed && <p className="mt-1.5 text-[11px] text-muted-foreground">{t('admin.inboxLive.notYourDecision')}</p>}

      {mode !== 'idle' && (
        <div className="mt-3 space-y-2.5 border-t pt-3">
          {mode === 'accept' && isService && (
            <>
              <p className="text-[11px] text-muted-foreground">{t('admin.inboxLive.serviceRecordNote')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label>{t('admin.common.vehicle')}</Label>
                  <NativeSelect value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                    <option value="">—</option>
                    {(vehicles.data?.data ?? []).map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.registrationNumber}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <Label>{t('admin.inboxLive.invoiceAttachment')}</Label>
                  <NativeSelect value={form.attachmentId} onChange={(e) => setForm({ ...form, attachmentId: e.target.value })}>
                    <option value="">—</option>
                    {receipts.map((attachment) => (
                      <option key={attachment.id} value={attachment.id}>
                        {attachment.filename}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <Label>{t('admin.common.amount')}</Label>
                  <Input value={form.amount} inputMode="decimal" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <Label>{t('admin.receiptAi.serviceDate')}</Label>
                  <Input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label>{t('admin.receiptAi.workshop')}</Label>
                  <Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <div>
            <Label>{t('admin.inboxLive.decisionNote')}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setMode('idle')}>
              {t('common.cancel')}
            </Button>
            {mode === 'accept' ? (
              <Button disabled={busy || (isService && !serviceReady)} onClick={() => void decide(true)}>
                <Check />
                {isService ? t('admin.inboxLive.createServiceRecord') : t('admin.inboxLive.accept')}
              </Button>
            ) : (
              <Button variant="destructive" disabled={busy} onClick={() => void decide(false)}>
                {t('admin.inboxLive.dismiss')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
