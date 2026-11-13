/**
 * Who someone is on an errand: its customer (in the customer app) or its assigned agent (in the agent
 * app). The one place this rule lives, for errands, uploads and ratings alike.
 */
export function participantRole(
  errand: { customerId: string; agentId: string | null } | undefined,
  auth: { app: 'customer' | 'agent'; userId: string },
): 'customer' | 'agent' | null {
  if (!errand) return null;
  if (auth.app === 'customer') return errand.customerId === auth.userId ? 'customer' : null;
  return errand.agentId === auth.userId ? 'agent' : null;
}
