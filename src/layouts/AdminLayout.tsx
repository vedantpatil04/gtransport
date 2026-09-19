import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calculator, Check, Ellipsis, Languages, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun } from 'lucide-react';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { DemoBar } from '@/components/demo/DemoBar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ADMIN_NAV, MOBILE_NAV } from '@/features/admin/nav';
import { useAdminBadges } from '@/features/admin/useAdminBadges';
import { GlobalSearch } from '@/features/admin/components/GlobalSearch';
import { NotificationsPopover } from '@/features/admin/components/NotificationsPopover';
import { CalculatorPanel } from '@/features/calculator/CalculatorPanel';
import { AdminLogin } from '@/features/admin/pages/AdminLogin';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';

const COLLAPSE_KEY = 'gangamata-sidebar-collapsed';

export function AdminLayout() {
  const { t } = useTranslation();
  const signedIn = useApp((s) => s.session.admin);
  const isDesktop = useMediaQuery('(min-width: 1280px)');
  const isTablet = useMediaQuery('(min-width: 768px)');
  const [pref, setPref] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem(COLLAPSE_KEY);
      return v === null ? null : v === '1';
    } catch {
      return null;
    }
  });
  // Tablets start with the icon rail; desktops with the full sidebar. The user's choice wins.
  const collapsed = pref ?? !isDesktop;
  const toggle = () => {
    const next = !collapsed;
    setPref(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!signedIn)
    return (
      <div className="min-h-dvh bg-background">
        <DemoBar />
        <AdminLogin />
      </div>
    );

  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-40">
        <DemoBar />
      </div>
      <div className="flex">
        {isTablet && <Sidebar collapsed={collapsed} onToggle={toggle} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onSearch={() => setSearchOpen(true)} onCalc={() => setCalcOpen(true)} />
          <main className={cn('min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7', !isTablet && 'pb-24')}>
            <div className="mx-auto max-w-[1440px] animate-in fade-in duration-200">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {!isTablet && <MobileNav />}
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Sheet open={calcOpen} onOpenChange={setCalcOpen}>
        <SheetContent side="right" className="w-full max-w-[460px] overflow-y-auto">
          <div className="p-5">
            <SheetTitle className="mb-4 pr-8">{t('admin.calc.title')}</SheetTitle>
            <CalculatorPanel compact />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const badges = useAdminBadges();
  return (
    <aside className={cn('sticky top-[37px] flex h-[calc(100dvh-37px)] shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-[248px]')} aria-label={t('admin.nav.label')}>
      <div className={cn('flex h-16 items-center border-b border-white/[0.06]', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Link to="/admin" aria-label={t('brand.name')}>
          {collapsed ? <LogoMark /> : <Logo tone="light" />}
        </Link>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3">
        <ul className="space-y-0.5">
          {ADMIN_NAV.map(({ key, to, icon: Icon, end }) => {
            const badge = badges[key];
            return (
              <li key={key}>
                <NavLink
                  to={to}
                  end={end}
                  title={collapsed ? t(`admin.nav.${key}`) : undefined}
                  data-testid={`admin-nav-${key}`}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-3 rounded-md text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-plate" />}
                      <Icon className="size-[18px] shrink-0" />
                      {!collapsed && <span className="flex-1 truncate">{t(`admin.nav.${key}`)}</span>}
                      {badge && (
                        <span
                          className={cn(
                            'figure flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
                            badge.tone === 'danger' ? 'bg-danger text-white' : badge.tone === 'warning' ? 'bg-warning text-white' : 'bg-white/15 text-white',
                            collapsed && 'absolute right-1.5 top-1 h-4 min-w-4 px-1 text-[10px]',
                          )}
                        >
                          {badge.count}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/[0.06] p-2.5">
        <button onClick={onToggle} className={cn('flex h-9 w-full items-center gap-3 rounded-md text-sm text-sidebar-muted hover:bg-white/[0.04] hover:text-white', collapsed ? 'justify-center' : 'px-3')} aria-label={collapsed ? t('admin.top.expand') : t('admin.top.collapse')}>
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && t('admin.top.collapse')}
        </button>
      </div>
    </aside>
  );
}

function Topbar({ onSearch, onCalc }: { onSearch: () => void; onCalc: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useApp((s) => s.theme);
  const adminLanguage = useApp((s) => s.adminLanguage);
  return (
    <header className="sticky top-[37px] z-30 flex h-16 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-6 lg:px-8">
      <Link to="/admin" className="md:hidden" aria-label={t('brand.name')}>
        <LogoMark />
      </Link>
      <button
        onClick={onSearch}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border bg-card px-3 text-left text-sm text-muted-foreground transition-colors hover:border-input md:max-w-md"
        data-testid="admin-search"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">{t('admin.top.search')}</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium lg:inline">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <Button variant="ghost" size="icon" onClick={onCalc} aria-label={t('admin.top.calculator')} title={t('admin.top.calculator')} data-testid="header-calculator">
          <Calculator />
        </Button>
        <NotificationsPopover />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('admin.top.language')} title={t('admin.top.language')} data-testid="admin-language">
              <Languages />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('admin.top.language')}</DropdownMenuLabel>
            <DropdownMenuCheckItem checked={adminLanguage === 'en'} onSelect={() => useApp.getState().setAdminLanguage('en')}>
              English
            </DropdownMenuCheckItem>
            <DropdownMenuCheckItem checked={adminLanguage === 'hi'} onSelect={() => useApp.getState().setAdminLanguage('hi')} data-testid="admin-lang-hi">
              हिंदी
            </DropdownMenuCheckItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex"
          onClick={() => useApp.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? t('admin.top.light') : t('admin.top.dark')}
          title={theme === 'dark' ? t('admin.top.light') : t('admin.top.dark')}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-0.5 hover:bg-accent sm:pr-3" aria-label={t('admin.top.profile')}>
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">AH</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-semibold">{t('admin.user.name')}</span>
                <span className="block text-xs text-muted-foreground">{t('admin.user.role')}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('admin.user.email')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate('/admin/settings')}>
              <Settings />
              {t('admin.nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem className="sm:hidden" onSelect={() => useApp.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              {theme === 'dark' ? t('admin.top.light') : t('admin.top.dark')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => useApp.getState().logout('admin')}>
              <LogOut />
              {t('admin.top.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function MobileNav() {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const badges = useAdminBadges();
  const inMore = !MOBILE_NAV.some((k) => {
    const item = ADMIN_NAV.find((n) => n.key === k)!;
    return item.end ? pathname === item.to : pathname.startsWith(item.to);
  });
  useEffect(() => setMore(false), [pathname]);
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label={t('admin.nav.label')}>
        <ul className="grid grid-cols-5">
          {MOBILE_NAV.map((key) => {
            const item = ADMIN_NAV.find((n) => n.key === key)!;
            const Icon = item.icon;
            return (
              <li key={key}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-primary' : 'text-muted-foreground')}>
                  <Icon className="size-5" />
                  <span className="max-w-full truncate px-1">{t(`admin.nav.${key}`)}</span>
                </NavLink>
              </li>
            );
          })}
          <li>
            <button onClick={() => setMore(true)} className={cn('relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold', inMore ? 'text-primary' : 'text-muted-foreground')}>
              <Ellipsis className="size-5" />
              {t('admin.nav.more')}
              {(badges.documents || badges.notifications) && <span className="absolute right-[30%] top-3 size-2 rounded-full bg-danger" />}
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom">
          <div className="px-4 pb-6 pt-2">
            <SheetTitle className="mb-3 px-1">{t('admin.nav.more')}</SheetTitle>
            <div className="grid grid-cols-3 gap-2">
              {ADMIN_NAV.map(({ key, to, icon: Icon, end }) => {
                const active = end ? pathname === to : pathname.startsWith(to);
                const badge = badges[key];
                return (
                  <NavLink key={key} to={to} end={end} className={cn('relative flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold', active ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent')}>
                    <Icon className="size-5" />
                    <span className="max-w-full truncate px-1">{t(`admin.nav.${key}`)}</span>
                    {badge && <span className="figure absolute right-2 top-2 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{badge.count}</span>}
                    {active && <Check className="absolute left-2 top-2 size-3.5" />}
                  </NavLink>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
