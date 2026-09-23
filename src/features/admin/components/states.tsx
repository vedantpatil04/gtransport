import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiError } from '@/lib/api/client';

/**
 * Loading, empty and error states shared by the screens that read from the API. They reuse
 * the existing panel/typography language rather than introducing a new visual system.
 */

export function TableLoading({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="px-4 py-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 border-b py-3 last:border-0">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className={colIndex === 0 ? 'h-9 w-44' : 'h-4 flex-1'} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </span>
      <div>
        <p className="font-medium">{t('admin.api.errorTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        {error.requestId && <p className="mt-1 text-xs text-muted-foreground">{t('admin.api.reference', { id: error.requestId })}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {t('admin.api.retry')}
        </Button>
      )}
    </div>
  );
}

/** Shown on connected screens when the admin has not signed in to the API yet. */
export function SignedOutState({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <PlugZap className="size-5" />
      </span>
      <div>
        <p className="font-medium">{t('admin.api.signedOutTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.api.signedOutBody')}</p>
      </div>
      <Button onClick={onSignIn}>{t('admin.api.signIn')}</Button>
    </div>
  );
}

export function InlineBusy({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </span>
  );
}
