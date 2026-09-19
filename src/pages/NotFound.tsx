import { MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { useApp } from '@/store';

export function NotFound() {
  const { t } = useTranslation();
  const role = useApp((s) => s.role);
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={MapPinOff}
        title={t('pages.notFound')}
        hint={t('pages.notFoundHint')}
        action={
          <Button asChild>
            <Link to={`/${role}`}>{t('pages.goHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}
