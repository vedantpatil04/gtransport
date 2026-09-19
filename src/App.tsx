import { BrowserRouter, HashRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppRoutes } from './routes';
import { AppEffects } from './components/AppEffects';
import { useApp } from './store';

/** The single-file demo build uses hash routing so it works from any host path. */
const Router = import.meta.env.MODE === 'demo' ? HashRouter : BrowserRouter;

export default function App() {
  const role = useApp((s) => s.role);
  const theme = useApp((s) => s.theme);
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppEffects />
      <AppRoutes />
      <Toaster
        position={role === 'driver' ? 'top-center' : 'bottom-right'}
        theme={role === 'admin' ? theme : 'light'}
        richColors
        closeButton={role === 'admin'}
        toastOptions={{ className: role === 'driver' ? 'text-[15px]' : undefined }}
      />
    </Router>
  );
}
