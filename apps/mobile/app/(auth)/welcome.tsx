import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VARIANT } from '@/config';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Art, WordmarkSvg } from '@/ui/svg';

const COPY = {
  customer: {
    title: 'Get your errands done',
    body: 'Groceries, parcels, pharmacy runs and queues, by verified agents near you. Your money is held until you have what you asked for.',
  },
  agent: {
    title: 'Earn running errands',
    body: 'Pick errands near you, agree your price before you start, and get paid when you hand over. Earnings go to your own bank account.',
  },
} as const;

/** The four illustrated tiles, tilted, as on the prototype's welcome. */
const TILES = [
  { art: 'groceries', style: { left: '6%', top: '16%', transform: [{ rotate: '-8deg' }] } },
  { art: 'parcel', style: { right: '6%', top: '9%', transform: [{ rotate: '7deg' }] } },
  { art: 'pharmacy', style: { left: '16%', bottom: '8%', transform: [{ rotate: '5deg' }] } },
  { art: 'queue', style: { right: '12%', bottom: '15%', transform: [{ rotate: '-6deg' }] } },
] as const;

const icon = { customer: require('../../assets/customer/icon.png'), agent: require('../../assets/agent/icon.png') };

/** The first screen: a dark hero with the illustrations, and the way in. */
export default function Welcome() {
  const c = useColors();
  const copy = COPY[VARIANT];
  // Tiles shrink on short screens so the two rows never overlap: each at most 40% of the space.
  const [room, setRoom] = useState(340);
  const tile = Math.max(64, Math.min(132, room * 0.4));
  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <SafeAreaView edges={['top']} style={styles.top}>
        <View style={styles.glow} />
        <View style={styles.brandline}>
          <Image source={icon[VARIANT]} style={styles.appic} accessibilityIgnoresInvertColors />
          <WordmarkSvg height={30} color="#FFFFFF" accent="#3DD68C" />
          {VARIANT === 'agent' ? (
            <View style={styles.agentTag}>
              <Text style={styles.agentText}>Agent</Text>
            </View>
          ) : null}
        </View>
        <View
          style={styles.collage}
          onLayout={(e) => setRoom(e.nativeEvent.layout.height)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {TILES.map((t) => (
            <View key={t.art} style={[styles.tile, t.style, { width: tile, height: tile, borderRadius: tile * 0.21 }]}>
              <Art name={t.art} size={tile * 0.7} />
            </View>
          ))}
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        <Text style={styles.title} accessibilityRole="header">
          {copy.title}
        </Text>
        <Text variant="sub" tone="ink3" style={{ marginBottom: 6 }}>
          {copy.body}
        </Text>
        <Button label="Get started" onPress={() => router.push('/phone')} />
        <Button kind="secondary" label="I already have an account" onPress={() => router.push('/phone')} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flex: 1, backgroundColor: '#0A0A0A', overflow: 'hidden', paddingHorizontal: 16, paddingTop: 22 },
  glow: {
    position: 'absolute',
    left: '-30%',
    right: '-30%',
    bottom: -160,
    height: 260,
    borderRadius: 400,
    backgroundColor: 'rgba(61,214,140,0.16)',
  },
  brandline: { flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 1 },
  appic: { width: 40, height: 40, borderRadius: 9 },
  agentTag: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  agentText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
  collage: { flex: 1 },
  tile: {
    position: 'absolute',
    backgroundColor: '#1C1C1C',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  },
  bottom: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 22, gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 27, lineHeight: 31, letterSpacing: -0.54 },
});
