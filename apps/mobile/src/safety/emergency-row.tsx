import { Row } from '../ui/parts';
import { useEmergency } from './use-emergency';

/**
 * The emergency button in a list (docs/security-plan.md, E9): calls the emergency number from the phone, and
 * tells Jiffo's safety team where you are and which errand you are on.
 */
export function EmergencyRow({ errandId }: { errandId?: string }) {
  const { number, press } = useEmergency();
  return (
    <Row
      icon="alert"
      tone="danger"
      title={`Emergency: call ${number}`}
      subtitle="Calls the emergency number, and tells Jiffo's safety team where you are"
      subtitleLines={2}
      onPress={() => press(errandId)}
    />
  );
}
