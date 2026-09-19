import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, House, UserRound, Wallet, ClipboardList } from 'lucide-react';
import { DemoBar } from '@/components/demo/DemoBar';
import { OfflineBanner } from '@/features/driver/components/OfflineBanner';
import { DriverLogin } from '@/features/driver/pages/DriverLogin';
import { useApp } from '@/store';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/driver', key: 'home', icon: House, end: true },
  { to: '/driver/updates', key: 'updates', icon: ClipboardList },
  { to: '/driver/payments', key: 'payments', icon: Wallet },
  { to: '/driver/documents', key: 'documents', icon: FileText },
  { to: '/driver/profile', key: 'profile', icon: UserRound },
] as const;

/** Focused flows hide the bottom bar so the primary button is always reachable. */
const FOCUSED = [/^\/driver\/fuel\/new/];

/**
 * Driver app shell — a phone-width column. On desktop it is centred so the client
 * sees the driver experience at the size drivers actually use it.
 */
export function DriverLayout() {
  const { pathname } = useLocation();
  const signedIn = useApp((s) => s.session.driver);
  const focused = FOCUSED.some((r) => r.test(pathname));

  return (
    <div className="min-h-dvh bg-[#dfe4ea]">
      <DemoBar />
      <div className="relative mx-auto flex min-h-[calc(100dvh-36px)] max-w-[440px] flex-col bg-background shadow-[0_0_0_1px_rgba(15,30,50,0.06),0_10px_40px_rgba(15,30,50,0.12)]">
        <OfflineBanner />
        {signedIn ? (
          <>
            <main className={cn('flex-1', !focused && 'pb-[84px]')}>
              <Outlet />
            </main>
            {!focused && <BottomNav />}
          </>
        ) : (
          <DriverLogin />
        )}
      </div>
    </div>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('driver.nav.home')}
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[440px] border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/90"
    >
      <ul className="grid grid-cols-5">
        {NAV.map(({ to, key, icon: Icon, ...rest }) => (
          <li key={key}>
            <NavLink
              to={to}
              end={'end' in rest}
              data-testid={`driver-nav-${key}`}
              className={({ isActive }) =>
                cn(
                  'flex h-[68px] flex-col items-center justify-center gap-1 px-0.5 text-[11.5px] font-semibold leading-tight transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors', isActive && 'bg-primary/10')}>
                    <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  <span className="max-w-full truncate text-center">{t(`driver.nav.${key}`)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
