import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/nav';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useDraft } from '@/errands/draft';
import { useColors } from '@/theme/theme';
import { Screen, Text } from '@/ui/kit';
import { Badge, Icon, IconCircle, List, Row } from '@/ui/parts';
import { CategoryArt } from '@/ui/category-art';

/** "Choose a category". From the home screen's See all it goes on to the plan. */
export default function Category() {
  const c = useColors();
  const { config } = useCountryConfig();
  const { draft, update } = useDraft();
  const { then } = useLocalSearchParams<{ then?: string }>();
  return (
    <Screen>
      <Text variant="heading" accessibilityRole="header">
        Choose a category
      </Text>
      <Text variant="sub" tone="ink3" style={{ marginTop: -8 }}>
        Only agents who take this category get your request.
      </Text>
      <List>
        {config?.categories.map((cat) => {
          const on = draft.categoryKey === cat.key;
          return (
            <Row
              key={cat.key}
              iconNode={
                <View>
                  <IconCircle size={48}>
                    <CategoryArt categoryKey={cat.key} icon={cat.icon} size={40} />
                  </IconCircle>
                  {on ? (
                    <View style={[styles.tick, { backgroundColor: c.ink, borderColor: c.surface }]}>
                      <Icon name="check" size={12} weight={3} color={c.onInk} />
                    </View>
                  ) : null}
                </View>
              }
              title={cat.name}
              selected={on}
              subtitle={cat.description || null}
              right={cat.buyDefault ? <Badge label="Buys items" /> : false}
              onPress={() => {
                // A new category resets the "agent buys items" switch to that category's default.
                update({ categoryKey: cat.key, buy: null });
                if (then === 'plan') router.replace('/plan');
                else goBack();
              }}
            />
          );
        })}
      </List>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The check on the chosen category's picture.
  tick: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
