import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { formatE164 } from '@/auth/phone';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { VARIANT } from '@/config';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Text } from '@/ui/kit';
import { Avatar, Icon } from '@/ui/parts';
import { TabPage } from '@/ui/tab-page';

interface Stats {
  ratingAvg: number | null;
  ratingCount: number;
  errandsCompleted: number;
  disputes: number;
}

/** Account, after the prototype: who you are, your numbers, settings, and signing out. */
export default function Account() {
  const c = useColors();
  const { api, user, signOut } = useSession();
  const { config } = useCountryConfig();
  const stats = useResource<Stats>('/v1/me/stats');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'out' | 'others' | null>(null);
  const [othersDone, setOthersDone] = useState(false);
  const agent = VARIANT === 'agent';
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Your account';

  const leave = async () => {
    setBusy('out');
    setError(null);
    try {
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  const leaveOthers = async () => {
    setBusy('others');
    setError(null);
    try {
      await api.post('/v1/auth/logout-others', {});
      setOthersDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const s = stats.data;
  return (
    <TabPage gap={18} refreshing={stats.refreshing} onRefresh={stats.refresh}>
      <View style={styles.acchead}>
        <Avatar name={user?.firstName} size={62} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.name} accessibilityRole="header" numberOfLines={2}>
            {name}
          </Text>
          <Text variant="small" tone="ink3">
            {user ? formatE164(user.phone, config?.country.phonePrefix ?? '') : '…'}
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat
          value={s ? (s.ratingAvg !== null ? `${s.ratingAvg.toFixed(1)} ★` : 'New') : '…'}
          label={s?.ratingCount ? `Rating · ${s.ratingCount}` : 'Your rating'}
        />
        <Stat value={s ? String(s.errandsCompleted) : '…'} label={agent ? 'Completed' : 'Errands'} />
        <Stat value={s ? String(s.disputes) : '…'} label="Disputes" />
      </View>

      {agent ? (
        <View style={styles.menu}>
          <MenuRow icon="tune" label="Errand preferences" onPress={() => router.push('/preferences')} />
          <MenuRow icon="chart" label="Earnings" onPress={() => router.push('/wallet')} />
          <MenuRow icon="bank" label="Payout account" onPress={() => router.push('/payout-account')} />
        </View>
      ) : null}

      <View style={[styles.minor, { borderTopColor: c.line }]}>
        <MinorRow
          label={othersDone ? 'Signed out of your other phones' : 'Sign out of other phones'}
          onPress={othersDone ? undefined : leaveOthers}
          busy={busy === 'others'}
        />
        <MinorRow label="Log out" onPress={leave} busy={busy === 'out'} />
      </View>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Text variant="note" tone="ink3">
        {agent ? 'Jiffo Agent' : 'Jiffo'} {Constants.expoConfig?.version ?? ''}
      </Text>
    </TabPage>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface2 }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text variant="note" tone="ink3">
        {label}
      </Text>
    </View>
  );
}

/** .mrow: a big settings row with an icon. */
function MenuRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.mrow, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={22} />
      <Text style={styles.mrowText}>{label}</Text>
      <Icon name="chev" size={18} color={c.ink3} />
    </Pressable>
  );
}

/** .minor: a quiet text row at the bottom of the page. */
function MinorRow({ label, onPress, busy }: { label: string; onPress?: () => void; busy?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress || busy, busy }}
      disabled={!onPress || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.minorRow, (pressed || busy) && { opacity: 0.5 }]}
    >
      <Text style={[styles.minorText, { color: onPress ? c.ink2 : c.ink3 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  acchead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontFamily: fonts.extrabold, fontSize: 25, lineHeight: 29, letterSpacing: -0.5 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, gap: 2 },
  statValue: { fontFamily: fonts.extrabold, fontSize: 20, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  menu: { paddingVertical: 4 },
  mrow: { flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 56 },
  mrowText: { flex: 1, fontFamily: fonts.semibold, fontSize: 17.5 },
  minor: { borderTopWidth: 1, paddingTop: 6 },
  minorRow: { minHeight: 46, justifyContent: 'center' },
  minorText: { fontFamily: fonts.medium, fontSize: 15.5 },
});
