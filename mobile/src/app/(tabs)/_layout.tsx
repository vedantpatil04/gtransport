import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Text, type ColorValue } from 'react-native';
import { CompulsoryLocationGuard } from '../../features/location/CompulsoryLocationGuard';
import { colors, TOUCH_TARGET } from '../../theme/tokens';

/**
 * The five tabs from the approved driver app. No extras: a driver should never hunt for
 * anything. Labels come from translations, so long scripts still fit.
 */
const ICONS = { home: '⌂', updates: '≡', payments: '₹', documents: '▤', profile: '☻' } as const;

function TabIcon({ name, color }: { name: keyof typeof ICONS; color: ColorValue }) {
  return (
    <Text allowFontScaling={false} style={{ fontSize: 20, color, lineHeight: 24 }}>
      {ICONS[name]}
    </Text>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <CompulsoryLocationGuard>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            minHeight: TOUCH_TARGET + (Platform.OS === 'ios' ? 20 : 12),
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarAllowFontScaling: false,
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: ({ color }) => <TabIcon name="home" color={color} /> }} />
        <Tabs.Screen name="updates" options={{ title: t('tabs.updates'), tabBarIcon: ({ color }) => <TabIcon name="updates" color={color} /> }} />
        <Tabs.Screen name="payments" options={{ title: t('tabs.payments'), tabBarIcon: ({ color }) => <TabIcon name="payments" color={color} /> }} />
        <Tabs.Screen name="documents" options={{ title: t('tabs.documents'), tabBarIcon: ({ color }) => <TabIcon name="documents" color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} /> }} />
      </Tabs>
    </CompulsoryLocationGuard>
  );
}
