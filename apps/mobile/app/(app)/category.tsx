import { router } from 'expo-router';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useDraft } from '@/errands/draft';
import { Screen, Text } from '@/ui/kit';
import { CategoryIcon, Icon, Row } from '@/ui/parts';

export default function Category() {
  const { config } = useCountryConfig();
  const { draft, update } = useDraft();
  return (
    <Screen>
      <Text variant="heading">Choose a category</Text>
      {config?.categories.map((cat) => (
        <Row
          key={cat.key}
          iconNode={<CategoryIcon icon={cat.icon} />}
          title={cat.name}
          subtitle={cat.description || null}
          right={draft.categoryKey === cat.key ? <Icon name="check" /> : null}
          onPress={() => {
            // A new category resets the "agent buys items" switch to that category's default.
            update({ categoryKey: cat.key, buy: null });
            router.back();
          }}
        />
      ))}
    </Screen>
  );
}
