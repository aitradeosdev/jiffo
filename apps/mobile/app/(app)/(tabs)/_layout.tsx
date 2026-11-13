import { Tabs } from 'expo-router/js-tabs';
import { VARIANT } from '@/config';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/parts';

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color }: { color: unknown }) => (
    <Icon name={icon} size={22} color={typeof color === 'string' ? color : undefined} />
  ),
});

/** Customer: Home, Errands, Wallet, Account. The agent app's tabs arrive with its screens. */
export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink3,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.line },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="home" options={tab('Home', 'home')} />
      <Tabs.Screen name="errands" options={{ ...tab('Errands', 'list'), hidden: VARIANT !== 'customer' }} />
      <Tabs.Screen name="wallet" options={{ ...tab('Wallet', 'credit-card'), hidden: VARIANT !== 'customer' }} />
      <Tabs.Screen name="account" options={tab('Account', 'user')} />
    </Tabs>
  );
}
