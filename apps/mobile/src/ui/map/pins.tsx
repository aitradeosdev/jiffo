import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../theme/theme';
import { fonts } from '../../theme/tokens';
import type { PinKind } from './types';

/** The prototype's stop markers: a ring circle for pickup, a ring square for drop-off, a dot between. */
export function StopMark({ kind, size = 12 }: { kind: PinKind; size?: number }) {
  const c = useColors();
  if (kind === 'stop')
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.ink3 }} />;
  const ring = Math.round(size * 0.29);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: kind === 'pick' ? size / 2 : 0,
        backgroundColor: c.surface,
        borderWidth: ring,
        borderColor: c.ink,
      }}
    />
  );
}

/** A pin as drawn on the map: stop markers a little larger, with a halo; the agent as a dark disc. */
export function MapPinView({ kind, label, radar }: { kind: PinKind; label?: string; radar?: boolean }) {
  const c = useColors();
  if (radar) {
    return (
      <View style={styles.radar}>
        <View style={[styles.ring, { width: 170, height: 170, borderRadius: 85, borderColor: c.ink3 }]} />
        <View style={[styles.ring, { width: 110, height: 110, borderRadius: 55, borderColor: c.ink3 }]} />
        <View style={[styles.halo, { backgroundColor: c.surface, borderRadius: 18, padding: 6 }]}>
          <StopMark kind={kind} size={20} />
        </View>
      </View>
    );
  }
  if (kind === 'agent') {
    return (
      <View style={[styles.agent, { backgroundColor: c.ink, borderColor: c.surface }]}>
        <Text style={{ color: c.onInk, fontFamily: fonts.bold, fontSize: 14 }}>
          {(label ?? '•').slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.halo, { backgroundColor: c.surface }]}>
      <StopMark kind={kind} size={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  radar: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5, opacity: 0.45 },
  halo: { padding: 3, borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.25)' },
  agent: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  },
});
