import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Navy title bar for driver sub-screens. The back button is a full 48px target. */
export function DriverHeader({ title, back, right, className }: { title: string; back?: string | true; right?: React.ReactNode; className?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <header className={cn('sticky top-0 z-30 flex h-14 items-center gap-1 bg-primary px-1.5 text-white', className)}>
      {back ? (
        <button
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
          className="flex size-12 items-center justify-center rounded-full hover:bg-white/10"
          aria-label={t('common.back')}
          data-testid="driver-back"
        >
          <ArrowLeft className="size-6" />
        </button>
      ) : (
        <span className="w-3" />
      )}
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
      {right}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-2 px-0.5">
      <h2 className="text-[15px] font-bold text-foreground/90">{children}</h2>
      {action}
    </div>
  );
}
