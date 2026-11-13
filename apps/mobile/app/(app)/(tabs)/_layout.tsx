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

/** Customer: Home, Errands, Wallet, Account. Agent: Board, Jobs, Earnings, Account. */
export default function TabsLayout() {
  const c = useColors();
  const agent = VARIANT === 'agent';
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
      <Tabs.Screen name="home" options={tab(agent ? 'Board' : 'Home', agent ? 'inbox' : 'home')} />
      <Tabs.Screen name="errands" options={tab(agent ? 'Jobs' : 'Errands', 'list')} />
      <Tabs.Screen name="wallet" options={tab(agent ? 'Earnings' : 'Wallet', 'credit-card')} />
      <Tabs.Screen name="account" options={tab('Account', 'user')} />
    </Tabs>
  );
}
