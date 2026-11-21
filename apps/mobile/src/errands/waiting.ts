import { whenLabel } from './when';

/**
 * What the customer reads while their errand waits for an agent. Urgent errands are offered to the nearest free
 * agents one at a time (docs/matching.md, M6), further out step by step, then to every agent within the last step
 * at once (M8), unless the country has offers off, when they're on the board for any agent nearby. `offers` comes
 * from the country's settings and `search` from the errand; an older server that sends neither has offers on.
 */
export function waitingCopy(input: {
  urgent: boolean;
  offers: boolean | undefined;
  /** The schedule while it is still ahead, else null. */
  scheduled: string | null;
  pickupLabel: string | null;
  search?: { radiusKm: number; everyone: boolean } | null;
}) {
  if (input.scheduled) {
    return {
      title: `Scheduled for ${whenLabel(input.scheduled)}`,
      sub: 'It goes on the board ahead of time, so an agent can accept it early.',
    };
  }
  if (input.urgent) {
    const { search } = input;
    return {
      title: 'Finding the nearest agent',
      sub:
        input.offers === false
          ? 'Agents nearby can see it. The first to accept gets it.'
          : search?.everyone
            ? `Every free agent within ${search.radiusKm} km can take it now. It goes to the first who accepts.`
            : search
              ? `Asking the nearest free agents one at a time, within ${search.radiusKm} km. It goes to the first who accepts.`
              : 'Asking the nearest free agents one at a time. It goes to the first who accepts.',
    };
  }
  return {
    title: 'Finding your agent',
    sub: `Agents near ${input.pickupLabel ?? 'your pickup'} can see it and accept.`,
  };
}

/**
 * Whether to ask the customer to raise the fee or keep waiting (M8): once it has waited the country's time for its
 * kind (Settings, Timers), as the server's push does. Never for one scheduled ahead, nor once anything changed
 * since it was sent (its fee raised, or back from an agent), nor without the settings to say when.
 */
export function raisePromptDue(
  errand: { createdAt: string; urgent: boolean; feeRaised: boolean },
  scheduled: string | null,
  timers: { raisePricePromptMinutes: number; boardRaisePromptMinutes: number } | undefined,
  now: number,
) {
  if (!timers || scheduled || errand.feeRaised) return false;
  const minutes = errand.urgent ? timers.raisePricePromptMinutes : timers.boardRaisePromptMinutes;
  return now - Date.parse(errand.createdAt) >= minutes * 60_000;
}
