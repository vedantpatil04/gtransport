import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/** Sticky page title for inner driver screens, with a large back target. */
export function DriverTopBar({ title, back, action }: { title: string; back?: string; action?: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b bg-card/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      {back && (
        <button onClick={() => navigate(back)} aria-label={t('common.back')} className="flex size-11 items-center justify-center rounded-full hover:bg-accent">
          <ArrowLeft className="size-6" />
        </button>
      )}
      <h1 className={`min-w-0 flex-1 truncate text-lg font-bold ${back ? '' : 'pl-2'}`}>{title}</h1>
      {action}
    </header>
  );
}
