import { Redirect } from 'expo-router';
import { officePath } from '../../features/office/modules';

/** An older address: the office Settings screen lives under /office, with the office tabs around it. */
export default function AdminSettingsRedirect() {
  return <Redirect href={officePath('settings')} />;
}
