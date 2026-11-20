import { SIGN_IN_RISK_INFO, SIGN_IN_RISKS, type SignInRisk } from '@jiffo/shared';

/** What a flag decision form sent: one of the three answers, or nothing (an Enter key, an old page). */
export const FLAG_DECISIONS = ['clear', 'confirm', 'reopen'] as const;
export type FlagDecision = (typeof FLAG_DECISIONS)[number];

export const flagDecisionOf = (value: unknown): FlagDecision | null => FLAG_DECISIONS.find((d) => d === value) ?? null;

/**
 * A risky sign-in flag in words (docs/security-plan.md, A10): its score, the app, and each reason, with the
 * cloud provider and the number of accounts on the phone where they are known.
 */
export function signInFinding(details: Record<string, unknown>) {
  const reasons = Array.isArray(details.reasons) ? details.reasons.map(String) : [];
  const words = reasons.map((r) => {
    const known = (SIGN_IN_RISKS as readonly string[]).includes(r);
    const label = known ? SIGN_IN_RISK_INFO[r as SignInRisk].label : r;
    const text = known ? label.charAt(0).toLowerCase() + label.slice(1) : label;
    if (r === 'data_centre' && details.provider) return `${text} (${String(details.provider)})`;
    if (r === 'shared_phone' && details.accounts) return `${text} (${Number(details.accounts)} accounts)`;
    return text;
  });
  const app = details.app ? ` in the ${String(details.app)} app` : '';
  return `Scored ${Number(details.score)}${app}: ${words.join(', ')}`;
}
