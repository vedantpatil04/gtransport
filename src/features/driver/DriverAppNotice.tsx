import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';

/**
 * Real mode: the driver web prototype runs on sample data, so it is not served. Drivers use the
 * Gangamata Transport phone app, which signs in to the same API.
 */
export function DriverAppNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm text-center" data-testid="driver-app-notice">
        <Logo size="lg" className="mb-8 flex justify-center" />
        <div className="panel flex flex-col items-center gap-3 p-6">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Smartphone className="size-6" />
          </span>
          <h1 className="text-lg font-bold">{t('driverAppNotice.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('driverAppNotice.body')}</p>
          <Button asChild variant="outline" className="mt-2">
            <Link to="/admin">{t('driverAppNotice.officeSignIn')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
