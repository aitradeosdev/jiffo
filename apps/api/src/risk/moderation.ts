/**
 * What moderation looks for in an errand (docs/security-plan.md, E5): asking an agent to carry or withdraw
 * cash, asking for money to be sent to a bank account, and a drop-off where the pickup is. Each only flags
 * the errand for the Risk queue: the words are common enough in honest errands that a person decides.
 */

/** Asking an agent to carry or withdraw cash. */
const CASH: RegExp[] = [
  /\bcash\b/gi,
  /\bnaira notes?\b/gi,
  /\bbank ?notes?\b/gi,
  /\b(?:atm|pos)\s+withdraw(?:al)?\b/gi,
  /\bwithdraw\b(?=[^.!?\n]{0,30}\b(?:atm|pos|money|naira)\b)/gi,
];

/** Asking for money to be sent to an account. */
const SEND: RegExp[] = [
  /\b(?:send|transfer|pay|credit|wire|remit)\b[^.!?\n]{0,40}?\b(?:to|into)\s+(?:my|his|her|their|our|this|that|the)\s+(?:bank\s+)?(?:account|acct|a\/c)\b/gi,
  /\b(?:account|acct|a\/c)\s*(?:number|no\b\.?|num\b|#)/gi,
  /\b(?:send|transfer)\s+(?:me\s+)?(?:the\s+|some\s+)?(?:money|funds)\b/gi,
];
/**
 * A 10-digit account number (NUBAN), but not the last ten digits of a phone number written with the country
 * code (+234 803 ...), and never kept: the flag says one was there, not what it was.
 */
const ACCOUNT_NUMBER = /(?<![\d+])(?<!234[\s-]?)\d{10}(?!\d)/;

const found = (text: string, patterns: RegExp[]) => [
  ...new Set(patterns.flatMap((p) => [...text.matchAll(p)].map((m) => m[0].toLowerCase().replace(/\s+/g, ' ')))),
];

export interface ModerationFinding {
  kind: 'cash_errand' | 'send_money';
  /** The words that raised it, for the reviewer; an account number is never one of them. */
  words: string[];
}

/** What an errand's description asks that moderation flags. */
export function moderate(description: string): ModerationFinding[] {
  const out: ModerationFinding[] = [];
  const cash = found(description, CASH);
  if (cash.length) out.push({ kind: 'cash_errand', words: cash });
  const send = found(description, SEND);
  if (ACCOUNT_NUMBER.test(description)) send.push('an account number');
  if (send.length) out.push({ kind: 'send_money', words: send });
  return out;
}
