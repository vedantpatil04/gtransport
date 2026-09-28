import { useRouter, useSegments, type Href } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../lib/auth/session-store';
import { Loading } from '../../components/ui';
import { routeFor } from './routing';

/**
 * Sends each person to the right place: login without a session, the password change while a
 * temporary password is in use, the driver app for drivers and the office app for office roles.
 * Redirecting here rather than inside screens means no screen renders for the wrong person.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const role = useSession((s) => s.role);
  const mustChangePassword = useSession((s) => Boolean(s.user?.mustChangePassword));
  const segments = useSegments() as string[];
  const router = useRouter();

  const target = routeFor({ status, role, mustChangePassword }, segments);
  useEffect(() => {
    if (target) router.replace(target as Href);
  }, [target, router]);

  if (status === 'loading') return <Loading />;
  return <>{children}</>;
}
