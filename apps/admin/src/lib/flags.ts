/** What a flag decision form sent: one of the three answers, or nothing (an Enter key, an old page). */
export const FLAG_DECISIONS = ['clear', 'confirm', 'reopen'] as const;
export type FlagDecision = (typeof FLAG_DECISIONS)[number];

export const flagDecisionOf = (value: unknown): FlagDecision | null => FLAG_DECISIONS.find((d) => d === value) ?? null;
