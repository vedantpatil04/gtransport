import { Redirect } from 'expo-router';
import { officePath } from '../../features/office/modules';

/** An older address: the office Inbox screen lives under /office, with the office tabs around it. */
export default function AdminInboxRedirect() {
  return <Redirect href={officePath('inbox')} />;
}
