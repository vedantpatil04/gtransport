import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calculator, Check, ChevronDown, ChevronRight, Ellipsis, KeyRound, Languages, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun } from 'lucide-react';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { DemoBar } from '@/components/demo/DemoBar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAdminNav, useCanOpen } from '@/features/admin/access';
import { ChangePasswordDialog, ForcedPasswordChange } from '@/features/admin/components/ChangePassword';
import { useAdminBadges } from '@/features/admin/useAdminBadges';
import { GlobalSearch } from '@/features/admin/components/GlobalSearch';
import { NotificationsPopover } from '@/features/admin/components/NotificationsPopover';
import { CalculatorPanel } from '@/features/calculator/CalculatorPanel';
import { AdminLogin } from '@/features/admin/pages/AdminLogin';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn, initials } from '@/lib/utils';
import { isApiConfigured } from '@/features/api/mode';
import { useSession } from '@/features/api/session';
import { useApp } from '@/store';

const COLLAPSE_KEY = 'gangamata-sidebar-collapsed';

export function AdminLayout() {
  const { t } = useTranslation();
  const connected = isApiConfigured();
  const token = useSession((s) => s.token);
  const mustChangePassword = useSession((s) => Boolean(s.user?.mustChangePassword));
  const demoSignedIn = useApp((s) => s.session.admin);
  const signedIn = connected ? Boolean(token) : demoSignedIn;

  // Real mode: re-read the account on load and whenever the tab regains focus, so a role or
  // status changed by an administrator never lingers in this browser.
  useEffect(() => {
    if (!connected || !token) return;
    const refresh = () => void useSession.getState().refresh();
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [connected, token]);
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
        {!connected && <DemoBar />}
        <AdminLogin />
      </div>
    );

  // A temporary password must be replaced before anything else; the API enforces the same.
  if (connected && mustChangePassword) return <ForcedPasswordChange />;

  return (
    <div className="min-h-dvh bg-background">
      {!connected && (
        <div className="sticky top-0 z-40">
          <DemoBar />
        </div>
      )}
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
  const location = useLocation();
  const navigate = useNavigate();
  const badges = useAdminBadges();
  const { items: ADMIN_NAV } = useAdminNav();

  const isItemActive = (item: (typeof ADMIN_NAV)[number]) => {
    if (item.children) {
      return item.children.some((child) => (child.end ? location.pathname === child.to : location.pathname.startsWith(child.to)));
    }
    return item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
  };

  const [openParents, setOpenParents] = useState<Record<string, boolean>>({
    employees: true,
    finance: true,
  });

  // Ensure active parent is expanded on route change
  useEffect(() => {
    for (const item of ADMIN_NAV) {
      if (item.children && isItemActive(item)) {
        setOpenParents((prev) => (prev[item.key] ? prev : { ...prev, [item.key]: true }));
      }
    }
  }, [location.pathname]);

  const toggleParent = (key: string) => {
    setOpenParents((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <aside
      className={cn(
        'sticky flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        // The demo bar only exists in demo mode.
        isApiConfigured() ? 'top-0 h-dvh' : 'top-[37px] h-[calc(100dvh-37px)]',
        collapsed ? 'w-[72px]' : 'w-[248px]',
      )}
      aria-label={t('admin.nav.label')}
    >
      <div className={cn('flex h-16 items-center border-b border-white/[0.06]', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Link to="/admin" aria-label={t('brand.name')}>
          {collapsed ? <LogoMark /> : <Logo tone="light" />}
        </Link>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3">
        <ul className="space-y-0.5">
          {ADMIN_NAV.map((item) => {
            const { key, to, icon: Icon, end, children } = item;
            const active = isItemActive(item);
            const badge = badges[item.badgeKey ?? key];
            const hasChildren = Boolean(children && children.length > 0);
            const isOpen = openParents[key] ?? true;

            // Collapsed Rail Mode
            if (collapsed) {
              if (hasChildren && children) {
                return (
                  <li key={key}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          title={t(`admin.nav.${key}`)}
                          data-testid={`admin-nav-${key}`}
                          className={cn(
                            'group relative flex h-10 w-full items-center justify-center rounded-md text-sm font-medium transition-colors',
                            active ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white',
                          )}
                        >
                          {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-plate" />}
                          <Icon className="size-[18px] shrink-0" />
                          {badge && (
                            <span className="figure absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                              {badge.count}
                            </span>
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-52 bg-sidebar text-sidebar-foreground border-white/10">
                        <DropdownMenuLabel>{t(`admin.nav.${key}`)}</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/10" />
                        {children.map((child) => {
                          const isChildActive = child.end ? location.pathname === child.to : location.pathname.startsWith(child.to);
                          const childBadge = child.badgeKey ? badges[child.badgeKey] : undefined;
                          return (
                            <DropdownMenuItem
                              key={child.key}
                              onSelect={() => navigate(child.to)}
                              className={cn(
                                'flex items-center justify-between text-xs font-medium cursor-pointer',
                                isChildActive ? 'text-white bg-white/10 font-semibold' : 'text-sidebar-muted hover:text-white hover:bg-white/[0.06]',
                              )}
                            >
                              <span>{t(`admin.nav.${child.key}`)}</span>
                              {childBadge && (
                                <span className="figure rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                                  {childBadge.count}
                                </span>
                              )}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              }

              return (
                <li key={key}>
                  <NavLink
                    to={to}
                    end={end}
                    title={t(`admin.nav.${key}`)}
                    data-testid={`admin-nav-${key}`}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex h-10 items-center justify-center rounded-md text-sm font-medium transition-colors',
                        isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-plate" />}
                        <Icon className="size-[18px] shrink-0" />
                        {badge && (
                          <span className="figure absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                            {badge.count}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            }

            // Expanded Mode: Parent with children
            if (hasChildren && children) {
              return (
                <li key={key} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleParent(key)}
                    data-testid={`admin-nav-${key}`}
                    className={cn(
                      'group relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors text-left',
                      active ? 'text-white font-semibold' : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white',
                    )}
                  >
                    {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-plate" />}
                    <Icon className="size-[18px] shrink-0" />
                    <span className="flex-1 truncate">{t(`admin.nav.${key}`)}</span>
                    {badge && (
                      <span
                        className={cn(
                          'figure flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
                          badge.tone === 'danger' ? 'bg-danger text-white' : badge.tone === 'warning' ? 'bg-warning text-white' : 'bg-white/15 text-white',
                        )}
                      >
                        {badge.count}
                      </span>
                    )}
                    {isOpen ? <ChevronDown className="size-4 shrink-0 opacity-60" /> : <ChevronRight className="size-4 shrink-0 opacity-60" />}
                  </button>

                  {isOpen && (
                    <ul className="ml-5 space-y-0.5 border-l border-white/10 pl-3">
                      {children.map((child) => {
                        const isChildActive = child.end ? location.pathname === child.to : location.pathname.startsWith(child.to);
                        const childBadge = child.badgeKey ? badges[child.badgeKey] : undefined;
                        return (
                          <li key={child.key}>
                            <NavLink
                              to={child.to}
                              end={child.end}
                              data-testid={`admin-nav-${child.key}`}
                              className={cn(
                                'group relative flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors',
                                isChildActive
                                  ? 'bg-sidebar-active text-white font-semibold'
                                  : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white',
                              )}
                            >
                              <span className="flex-1 truncate">{t(`admin.nav.${child.key}`)}</span>
                              {childBadge && (
                                <span className="figure flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                                  {childBadge.count}
                                </span>
                              )}
                            </NavLink>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            }

            // Expanded Mode: Direct item (no children)
            return (
              <li key={key}>
                <NavLink
                  to={to}
                  end={end}
                  data-testid={`admin-nav-${key}`}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                      isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-plate" />}
                      <Icon className="size-[18px] shrink-0" />
                      <span className="flex-1 truncate">{t(`admin.nav.${key}`)}</span>
                      {badge && (
                        <span
                          className={cn(
                            'figure flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
                            badge.tone === 'danger' ? 'bg-danger text-white' : badge.tone === 'warning' ? 'bg-warning text-white' : 'bg-white/15 text-white',
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
  const connected = isApiConfigured();
  const account = useSession((s) => s.user);
  const canOpenSettings = useCanOpen('settings');
  const [changingPassword, setChangingPassword] = useState(false);
  // Real mode shows who is actually signed in; demo mode keeps the prototype's sample person.
  const name = connected ? account?.displayName ?? '' : t('admin.user.name');
  const roleLabel = connected ? (account ? t(`admin.enum.userRole.${account.role}`) : '') : t('admin.user.role');
  const signInId = connected ? account?.email ?? account?.phone ?? '' : t('admin.user.email');
  return (
    <header className={cn('sticky z-30 flex h-16 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-6 lg:px-8', connected ? 'top-0' : 'top-[37px]')}>
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
        {/* Notifications have no live source yet; real mode shows no sample unread count. */}
        {!connected && <NotificationsPopover />}
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
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{connected ? initials(name) : 'AH'}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-semibold" data-testid="topbar-name">{name}</span>
                <span className="block text-xs text-muted-foreground" data-testid="topbar-role">{roleLabel}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{signInId}</DropdownMenuLabel>
            {canOpenSettings && (
              <DropdownMenuItem onSelect={() => navigate('/admin/settings')}>
                <Settings />
                {t('admin.nav.settings')}
              </DropdownMenuItem>
            )}
            {connected && (
              <DropdownMenuItem onSelect={() => setChangingPassword(true)} data-testid="menu-change-password">
                <KeyRound />
                {t('admin.password.title')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="sm:hidden" onSelect={() => useApp.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              {theme === 'dark' ? t('admin.top.light') : t('admin.top.dark')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={() => {
                useSession.getState().signOut();
                useApp.getState().logout('admin');
              }}
            >
              <LogOut />
              {t('admin.top.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
    </header>
  );
}

function MobileNav() {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const badges = useAdminBadges();
  const { items: ADMIN_NAV, mobile: MOBILE_NAV } = useAdminNav();

  const isKeyActive = (key: string) => {
    const item = ADMIN_NAV.find((n) => n.key === key);
    if (!item) return false;
    if (item.children) {
      return item.children.some((child) => (child.end ? pathname === child.to : pathname.startsWith(child.to)));
    }
    return item.end ? pathname === item.to : pathname.startsWith(item.to);
  };

  const inMore = !MOBILE_NAV.some(isKeyActive);
  useEffect(() => setMore(false), [pathname]);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label={t('admin.nav.label')}>
        <ul className="grid grid-cols-5">
          {MOBILE_NAV.map((key) => {
            const item = ADMIN_NAV.find((n) => n.key === key)!;
            const Icon = item.icon;
            const active = isKeyActive(key);
            const badge = badges[item.badgeKey ?? item.key];
            return (
              <li key={key}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={cn(
                    'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-5" />
                  <span className="max-w-full truncate px-1">{t(`admin.nav.${key}`)}</span>
                  {badge && (
                    <span className="figure absolute right-3 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                      {badge.count}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button
              onClick={() => setMore(true)}
              className={cn(
                'relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                inMore ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Ellipsis className="size-5" />
              {t('admin.nav.more')}
              {(badges.documents || badges.notifications || badges.inbox) && (
                <span className="absolute right-[30%] top-3 size-2 rounded-full bg-danger" />
              )}
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <div className="px-3 pb-6 pt-2">
            <SheetTitle className="mb-3 px-1">{t('admin.nav.more')}</SheetTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ADMIN_NAV.map((item) => {
                const active = isKeyActive(item.key);
                const badge = badges[item.badgeKey ?? item.key];
                const Icon = item.icon;

                if (item.children) {
                  return (
                    <div key={item.key} className="col-span-2 rounded-lg border bg-muted/20 p-2.5 sm:col-span-3">
                      <div className="flex items-center gap-2 font-semibold text-xs text-muted-foreground mb-2">
                        <Icon className="size-4" />
                        <span>{t(`admin.nav.${item.key}`)}</span>
                        {badge && (
                          <span className="figure rounded-full bg-danger px-1.5 text-[10px] font-bold text-white ml-auto">
                            {badge.count}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {item.children.map((child) => {
                          const childActive = child.end ? pathname === child.to : pathname.startsWith(child.to);
                          const childBadge = child.badgeKey ? badges[child.badgeKey] : undefined;
                          return (
                            <NavLink
                              key={child.key}
                              to={child.to}
                              end={child.end}
                              className={cn(
                                'flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-xs font-semibold transition-colors',
                                childActive ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-foreground',
                              )}
                            >
                              <span className="truncate px-1">{t(`admin.nav.${child.key}`)}</span>
                              {childBadge && (
                                <span className="figure rounded-full bg-danger px-1.5 text-[9px] font-bold text-white">
                                  {childBadge.count}
                                </span>
                              )}
                            </NavLink>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                return (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    end={item.end}
                    className={cn(
                      'relative flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors',
                      active ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                    <span className="max-w-full truncate px-1">{t(`admin.nav.${item.key}`)}</span>
                    {badge && (
                      <span className="figure absolute right-2 top-2 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                        {badge.count}
                      </span>
                    )}
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
