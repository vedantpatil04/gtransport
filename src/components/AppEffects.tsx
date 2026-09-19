import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { applyLanguage } from '@/i18n';
import { useApp, useCurrentDriver } from '@/store';

/**
 * App-wide side effects: role follows the URL, language + theme follow the active role,
 * last route per role is remembered, expiry reminders are generated, and queued
 * offline updates are uploaded when the network returns.
 */
export function AppEffects() {
  const { pathname, search } = useLocation();
  const { t } = useTranslation();
  const role = useApp((s) => s.role);
  const setRole = useApp((s) => s.setRole);
  const setLastRoute = useApp((s) => s.setLastRoute);
  const adminLanguage = useApp((s) => s.adminLanguage);
  const theme = useApp((s) => s.theme);
  const offline = useApp((s) => s.offline);
  const driver = useCurrentDriver();

  const routeRole = pathname.startsWith('/admin') ? 'admin' : pathname.startsWith('/driver') ? 'driver' : null;

  useEffect(() => {
    if (routeRole && routeRole !== role) setRole(routeRole);
    if (routeRole) setLastRoute(routeRole, pathname + search);
  }, [routeRole, role, pathname, search, setRole, setLastRoute]);

  const activeLang = (routeRole ?? role) === 'admin' ? adminLanguage : driver.language;
  useEffect(() => applyLanguage(activeLang), [activeLang]);

  // Drivers always get the light theme (outdoor readability); admin follows the toggle.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', (routeRole ?? role) === 'admin' && theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1B2B44');
  }, [routeRole, role, theme]);

  // Daily reminder check (30 / 15 / 7 / 3 days and expired).
  useEffect(() => {
    useApp.getState().runExpiryCheck();
  }, []);

  // Offline → online: upload whatever was saved on the phone.
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline) {
      const count = useApp.getState().pendingSyncCount();
      if (count > 0) {
        const id = toast.loading(t('offline.syncing'));
        window.setTimeout(() => {
          const n = useApp.getState().syncPending();
          toast.success(t('offline.synced'), { id, description: t('offline.syncedCount', { count: n }) });
        }, 1400);
      }
    }
    wasOffline.current = offline;
  }, [offline, t]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return null;
}
