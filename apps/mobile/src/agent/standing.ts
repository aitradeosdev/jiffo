import { timeLabel } from '../errands/when';

/** How the agent stands (GET /v1/agent/standing; docs/matching.md, M9). */
export interface Standing {
  /** Of their last counted offers, the share they took; null with none yet. */
  acceptanceRate: number | null;
  /** Of the errands they accepted lately, the share they didn't leave. */
  completionRate: number | null;
  cancellations7d: number;
  offersPausedUntil: string | null;
}

const percent = (rate: number | null) => (rate === null ? 'New' : `${Math.round(rate * 100)}%`);

/** The figures beside their rating on the account screen. */
export function standingFigures(s: Standing) {
  return [
    { value: percent(s.acceptanceRate), label: 'Acceptance' },
    { value: percent(s.completionRate), label: 'Completion' },
    { value: String(s.cancellations7d), label: 'Left this week' },
  ];
}

/** While Jiffo has paused their offers for a low acceptance rate, what the board and account say; else null. */
export function pausedNote(until: string | null, now: number): string | null {
  if (!until || Date.parse(until) <= now) return null;
  return `Offers are paused until ${timeLabel(new Date(until))} for a low acceptance rate. The board still works.`;
}
