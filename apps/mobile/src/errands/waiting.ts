import { whenLabel } from './when';

/**
 * What the customer reads while their errand waits for an agent. Urgent errands are offered to the nearest free
 * agents one at a time (docs/matching.md, M6) unless the country has offers off, when they're on the board for
 * any agent nearby; `offers` comes from the country's settings, and an older server that doesn't say has them on.
 */
export function waitingCopy(input: {
  urgent: boolean;
  offers: boolean | undefined;
  /** The schedule while it is still ahead, else null. */
  scheduled: string | null;
  pickupLabel: string | null;
}) {
  if (input.scheduled) {
    return {
      title: `Scheduled for ${whenLabel(input.scheduled)}`,
      sub: 'It goes on the board ahead of time, so an agent can accept it early.',
    };
  }
  if (input.urgent) {
    return {
      title: 'Finding the nearest agent',
      sub:
        input.offers === false
          ? 'Agents nearby can see it. The first to accept gets it.'
          : 'The nearest free agents are asked one at a time. It goes to the first who accepts.',
    };
  }
  return {
    title: 'Finding your agent',
    sub: `Agents near ${input.pickupLabel ?? 'your pickup'} can see it and accept.`,
  };
}
