import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useApp, useCurrentDriver } from '@/store';

const DEMO_OTP = '2468';

/** Shown after "Logout". Phone + OTP, pre-filled for the demo. */
export function DriverLogin() {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = () => {
    if (otp.length !== 4) return setError(t('driver.login.errOtp'));
    if (otp !== DEMO_OTP) return setError(t('driver.login.wrongOtp'));
    useApp.getState().login('driver');
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-primary px-6 pb-10 pt-10 text-white">
        <Logo tone="light" size="lg" />
        <h1 className="mt-10 text-3xl font-bold">{t('driver.login.welcome')}</h1>
        <p className="mt-1 text-white/70">{t('driver.login.title')}</p>
      </div>
      <div className="flex-1 space-y-5 px-6 py-8">
        <div className="space-y-2">
          <Label htmlFor="phone">{t('driver.login.phone')}</Label>
          <div className="flex h-14 items-center gap-2 rounded-lg border border-input bg-card px-4 text-lg">
            <Smartphone className="size-5 text-muted-foreground" />
            <span className="figure font-semibold" id="phone">
              {driver.phone}
            </span>
          </div>
        </div>
        {step === 'phone' ? (
          <Button size="xl" className="w-full" onClick={() => setStep('otp')}>
            {t('driver.login.sendOtp')}
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('driver.login.otpSent', { phone: driver.phone })}</p>
            <div className="space-y-2">
              <Label htmlFor="otp">{t('driver.login.enterOtp')}</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={otp}
                aria-invalid={!!error}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setError(null);
                }}
                className="figure h-16 text-center text-3xl font-bold tracking-[0.6em]"
              />
              <FieldError>{error}</FieldError>
              <p className="rounded-md border border-dashed bg-muted/60 px-3 py-2 text-center text-sm text-muted-foreground">{t('driver.login.demoOtp', { otp: DEMO_OTP })}</p>
            </div>
            <Button size="xl" className="w-full" onClick={verify}>
              {t('driver.login.verify')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
