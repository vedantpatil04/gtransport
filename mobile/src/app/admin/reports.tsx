import { Redirect } from 'expo-router';
import { officePath } from '../../features/office/modules';

/** An older address: the office Reports screen lives under /office, with the office tabs around it. */
export default function AdminReportsRedirect() {
  return <Redirect href={officePath('reports')} />;
}
