import { useLocalSearchParams } from 'expo-router';
import { VARIANT } from '@/config';
import { AgentErrand } from '@/errands/agent-errand';
import { CustomerErrand } from '@/errands/customer-errand';

/** One errand: the customer's tracker in the customer app, the job screen in the agent app. */
export default function ErrandScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return VARIANT === 'agent' ? <AgentErrand id={id} /> : <CustomerErrand id={id} />;
}
