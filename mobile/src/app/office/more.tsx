import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, View } from 'react-native';
import { AppText, Card, Row } from '../../components/ui';
import { officePath, sectionsFor, type OfficeModule } from '../../features/office/modules';
import { OfficeScreen } from '../../features/office/ui';
import { useSession } from '../../lib/auth/session-store';
import { API_URL } from '../../lib/config';
import { colors, spacing } from '../../theme/tokens';

/** The role's remaining modules organized by section, and Profile. Nothing here the role may not open. */
export default function OfficeMore() {
  const { t } = useTranslation();
  const router = useRouter();
  const role = useSession((s) => s.role);
  const sections = sectionsFor(role);

  const handlePress = (module: OfficeModule) => {
    const path = officePath(module);
    if (typeof path === 'string' && path.startsWith('/admin')) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(path);
      } else {
        const baseUrl =
          process.env.EXPO_PUBLIC_WEB_URL ||
          (API_URL ? API_URL.replace(/:\d+$/, ':5173') : 'http://localhost:5173');
        const fullUrl = `${baseUrl.replace(/\/+$/, '')}${path}`;
        void Linking.openURL(fullUrl).catch((err) => {
          console.warn('[OfficeMore] Could not open admin URL:', fullUrl, err);
        });
      }
      return;
    }
    router.push(path);
  };

  return (
    <OfficeScreen title={t('office.nav.more')} testID="office-more">
      <View style={{ gap: spacing.lg }}>
        {sections.map((section) => (
          <View key={section.key} style={{ gap: spacing.xs }} testID={`office-section-${section.key}`}>
            <AppText
              variant="label"
              tone="muted"
              style={{
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                paddingHorizontal: spacing.xs,
              }}
            >
              {t(`office.section.${section.key}`)}
            </AppText>
            <Card style={{ paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' }}>
              {section.modules.map((module, index) => (
                <View key={module}>
                  {index > 0 && <View style={{ height: 1, backgroundColor: colors.border }} />}
                  <Row
                    label={t(`office.nav.${module}`)}
                    onPress={() => handlePress(module)}
                    right={<AppText tone="muted">›</AppText>}
                    testID={`office-more-${module}`}
                  />
                </View>
              ))}
            </Card>
          </View>
        ))}
      </View>
    </OfficeScreen>
  );
}
