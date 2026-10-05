import { Redirect } from 'expo-router';
import { officePath } from '../../features/office/modules';

/** An older address: the office Fleet screen lives under /office, with the office tabs around it. */
export default function AdminFleetRedirect() {
  return <Redirect href={officePath('fleet')} />;
}
