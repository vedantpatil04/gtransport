import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../lib/auth/session-store';
import { Loading } from '../../components/ui';

/**
 * Sends the driver to login when there is no session, and into the app when there is.
 * Redirecting here rather than inside screens means no screen ever renders without a session.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'signedOut' && !inAuthGroup) router.replace('/(auth)/login');
    if (status === 'signedIn' && inAuthGroup) router.replace('/(tabs)');
  }, [status, segments, router]);

  if (status === 'loading') return <Loading />;
  return <>{children}</>;
}
