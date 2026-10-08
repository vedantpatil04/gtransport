import { AdminConsole } from '../features/console/AdminConsole';

/** Office roles: the production office console. AuthGate keeps every other role out. */
export default function ConsoleScreen() {
  return <AdminConsole />;
}
