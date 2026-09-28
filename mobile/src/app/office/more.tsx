import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card, Row, AppText } from '../../components/ui';
import { moreFor, officePath } from '../../features/office/modules';
import { OfficeScreen } from '../../features/office/ui';
import { useSession } from '../../lib/auth/session-store';
import { colors } from '../../theme/tokens';

/** The role's remaining modules, and Profile. Nothing here the role may not open. */
export default function OfficeMore() {
  const { t } = useTranslation();
  const router = useRouter();
  const role = useSession((s) => s.role);
  const modules = moreFor(role);

  return (
    <OfficeScreen title={t('office.nav.more')} testID="office-more">
      <Card style={{ paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' }}>
        {modules.map((module, index) => (
          <View key={module}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.border }} />}
            <Row label={t(`office.nav.${module}`)} onPress={() => router.push(officePath(module))} right={<AppText tone="muted">›</AppText>} testID={`office-more-${module}`} />
          </View>
        ))}
      </Card>
    </OfficeScreen>
  );
}
