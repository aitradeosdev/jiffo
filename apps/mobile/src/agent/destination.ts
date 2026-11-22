/** Where the agent is heading, such as home (GET /v1/agent/destination; docs/matching.md, M13). */
export interface DestinationStatus {
  enabled: boolean;
  destination: { lat: number; lng: number; label: string; setAt: string } | null;
  usesPerDay: number;
  usesLeft: number;
}

/** The board's chip: where they are heading, or an offer to set it; none where destination mode is off. */
export function destinationChip(status: DestinationStatus | null): string | null {
  if (!status?.enabled) return null;
  return status.destination ? `To ${status.destination.label}` : 'Heading somewhere?';
}

/** What destination mode does now, and how many more they may set today. */
export function destinationNote(status: DestinationStatus): string {
  const left = status.usesLeft > 0 ? `${status.usesLeft} of ${status.usesPerDay} left today.` : 'None left today.';
  return status.destination
    ? `Only errands that take you closer to ${status.destination.label}. It ends when you get there. ${left}`
    : `Set where you're heading, such as home, to see only errands that take you closer. ${left}`;
}
