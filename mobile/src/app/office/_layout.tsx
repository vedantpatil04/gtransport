import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Text, type ColorValue } from 'react-native';
import { moreFor, tabsFor, type OfficeModule } from '../../features/office/modules';
import { useSession } from '../../lib/auth/session-store';
import { colors, TOUCH_TARGET } from '../../theme/tokens';

/**
 * The office app: a phone-sized take on the admin console, not the desktop pages shrunk.
 * Each role sees up to four of its modules on the tab bar, in the order it uses them most,
 * and the rest under More. Modules a role may not use are not routes it can reach from here;
 * the API refuses them regardless.
 */
const ICONS: Record<OfficeModule | 'more', string> = {
  dashboard: '⌂',
  finance: '₹',
  vehicles: '⛟',
  fuel: '⛽',
  documents: '▤',
  employees: '☷',
  profile: '☻',
  more: '⋯',
};

/** Route file for each module (the dashboard is the index). */
const ROUTE: Record<OfficeModule, string> = {
  dashboard: 'index',
  finance: 'finance',
  vehicles: 'vehicles',
  fuel: 'fuel',
  documents: 'documents',
  employees: 'employees',
  profile: 'profile',
};

const ALL: OfficeModule[] = ['dashboard', 'finance', 'vehicles', 'fuel', 'documents', 'employees', 'profile'];

function TabIcon({ name, color }: { name: OfficeModule | 'more'; color: ColorValue }) {
  return (
    <Text allowFontScaling={false} style={{ fontSize: 20, color, lineHeight: 24 }}>
      {ICONS[name]}
    </Text>
  );
}

export default function OfficeLayout() {
  const { t } = useTranslation();
  const role = useSession((s) => s.role);
  const tabs = tabsFor(role);
  const hasMore = moreFor(role).length > 0;
  // Tab order follows the role; everything else is declared but hidden from the bar.
  const order: OfficeModule[] = [...tabs, ...ALL.filter((m) => !tabs.includes(m))];

  return (
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
      {order.map((module) => (
        <Tabs.Screen
          key={module}
          name={ROUTE[module]}
          options={{
            title: t(`office.nav.${module}`),
            tabBarIcon: ({ color }) => <TabIcon name={module} color={color} />,
            tabBarButtonTestID: `office-tab-${module}`,
            ...(tabs.includes(module) ? {} : { href: null }),
          }}
        />
      ))}
      <Tabs.Screen
        name="more"
        options={{
          title: t('office.nav.more'),
          tabBarIcon: ({ color }) => <TabIcon name="more" color={color} />,
          tabBarButtonTestID: 'office-tab-more',
          ...(hasMore ? {} : { href: null }),
        }}
      />
    </Tabs>
  );
}
