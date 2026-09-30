import { Redirect } from 'expo-router';
import { Loading, Screen } from '../src/components/ui';
import { useAuth } from '../src/state/auth';

export default function Index() {
  const { status, workspace } = useAuth();
  if (status === 'loading') return <Screen><Loading /></Screen>;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  return <Redirect href={workspace.kind === 'merchant' ? '/dashboard' : '/home'} />;
}
