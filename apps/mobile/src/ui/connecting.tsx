import { ActivityIndicator, View } from 'react-native';
import { useColors } from '../theme/theme';
import { Screen, Text } from './kit';

/** Shown while the app reaches the server, for example when it was opened offline. */
export function Connecting() {
  const c = useColors();
  return (
    <Screen scroll={false}>
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator color={c.ink3} />
        <Text tone="ink3">Connecting to Jiffo…</Text>
      </View>
    </Screen>
  );
}
