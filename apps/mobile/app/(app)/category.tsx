import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/nav';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useDraft } from '@/errands/draft';
import { Screen, Text } from '@/ui/kit';
import { Badge, IconCircle, List, Row } from '@/ui/parts';

/** "Choose a category". From the home screen's See all it goes on to the plan. */
export default function Category() {
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
              iconNode={<IconCircle icon={on ? 'check' : cat.icon} tone={on ? 'ink' : undefined} />}
              title={cat.name}
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
