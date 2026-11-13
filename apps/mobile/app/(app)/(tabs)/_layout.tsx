import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VARIANT } from '@/config';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/parts';

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, focused }: { color: unknown; focused: boolean }) => (
    <Icon name={icon} size={24} weight={focused ? 2.3 : 1.8} color={typeof color === 'string' ? color : undefined} />
  ),
});

/** Customer: Home, Errands, Wallet, Account. Agent: Home, Earnings, Errands, Account. */
export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const agent = VARIANT === 'agent';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, height: 68 + insets.bottom, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11.5 },
      }}
    >
      <Tabs.Screen name="home" options={tab('Home', 'home')} />
      {/* The prototype puts Earnings second in the agent app and Errands second in the customer app. */}
      {agent ? <Tabs.Screen name="wallet" options={tab('Earnings', 'chart')} /> : null}
      <Tabs.Screen name="errands" options={tab('Errands', 'history')} />
      {agent ? null : <Tabs.Screen name="wallet" options={tab('Wallet', 'wallet')} />}
      <Tabs.Screen name="account" options={tab('Account', 'user')} />
    </Tabs>
  );
}
