import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Archive, Ban, Check, Download, Inbox, MailOpen, Paperclip, RefreshCw, ShieldQuestion, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { fetchInboxAttachment, inboxApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import type { ApiInboxClassification, ApiInboxStatus } from '@/features/api/types';
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
 * Two things this screen is careful about. A category set by a person and a category suggested by
 * a model look different, because they are different: the first is a decision, the second is a
 * guess that the office is free to overrule — and once they do, no later run changes it back. And
 * an attachment that was refused on the way in is still shown, with the reason, so "nothing
 * arrived" and "something arrived and we would not keep it" can never be confused.
 *
 * Nothing on this screen sends, replies to, forwards or deletes anything. The server offers no way
 * to, which is the point: an inbound mailbox that can act is an inbound mailbox that can be used
 * against the company.
 */

const CLASSIFICATIONS: ApiInboxClassification[] = [
  'UNCLASSIFIED', 'SERVICE_INVOICE', 'DOCUMENT', 'PAYMENT_NOTIFICATION',
  'GOVERNMENT', 'CUSTOMER', 'OPERATIONAL', 'SPAM', 'OTHER',
];

const CLASSIFICATION_TONE: Record<ApiInboxClassification, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  UNCLASSIFIED: 'neutral',
  SERVICE_INVOICE: 'info',
  DOCUMENT: 'info',
  PAYMENT_NOTIFICATION: 'success',
  GOVERNMENT: 'warning',
  CUSTOMER: 'neutral',
  OPERATIONAL: 'neutral',
  SPAM: 'danger',
  OTHER: 'neutral',
};

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

  const filters = { status: status || undefined, classification: classification || undefined, q: search || undefined };
  const mailbox = useApiResource(() => inboxApi.status(), []);
  const summary = useApiResource(() => inboxApi.summary(), []);
  const messages = useApiResource(() => inboxApi.list({ ...filters, limit: 50 }), [JSON.stringify(filters)]);

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

      {/* No mailbox configured is a different fact from no mail, and says so. */}
      {info && !info.configured && (
        <div className="panel flex items-start gap-3 p-4">
          <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">{t('admin.inboxLive.notConfiguredTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('admin.inboxLive.notConfiguredBody')}</p>
          </div>
        </div>
      )}

      {info?.configured && info.lastError && (
        <div className="panel flex items-start gap-3 border-danger/40 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-semibold text-danger">{t('admin.inboxLive.lastSyncFailed')}</p>
            <p className="mt-1 text-sm text-foreground/80">{info.lastError}</p>
            {info.consecutiveFailures > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('admin.inboxLive.consecutiveFailures', { count: info.consecutiveFailures })}
              </p>
            )}
          </div>
        </div>
      )}

      {info?.configured && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={t('admin.inboxLive.unread')} value={String(summary.data?.unread ?? 0)} icon={Inbox} />
          <StatCard
            label={t('admin.inboxLive.needsAttention')}
            value={String(summary.data?.needingAttention ?? 0)}
            icon={AlertTriangle}
            sub={t('admin.inboxLive.needsAttentionSub')}
          />
          <StatCard
            label={t('admin.inboxLive.mailbox')}
            value={info.mailbox ?? '—'}
            icon={MailOpen}
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

/** One message in full: the text, what arrived with it, and what the office decides it is. */
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

  const setClassification = async (next: ApiInboxClassification) => {
    if (!data) return;
    setBusy(true);
    try {
      await inboxApi.classify(data.id, next);
      toast.success(t('admin.inboxLive.categorySet'));
      message.reload();
      onChanged();
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
      message.reload();
      onChanged();
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
      // An unapplied result is not a failure: it means a person had already decided.
      toast.success(outcome.applied ? t('admin.inboxLive.reread') : t('admin.inboxLive.rereadNotApplied'));
      message.reload();
      onChanged();
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
                    </p>
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

              {data.ai.status === 'FAILED' && (
                <p className="rounded-lg border border-danger/40 bg-danger-soft/50 p-3 text-xs text-foreground/80">
                  {data.ai.failureMessage ?? t('admin.inboxLive.readingFailed')}
                </p>
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
                              : /* Refused, and the reason is shown: something arrived, and it was not kept. */
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
