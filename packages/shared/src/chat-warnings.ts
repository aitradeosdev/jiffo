/**
 * Chat warnings (docs/security-plan.md, C3): a message with a link, a phone number, a bank account number or
 * a push to pay outside the app is shown with a warning beside it. The server decides when a message is
 * sent and keeps the answer with it; both apps and the panel show it. Nothing is blocked: the words are
 * common enough in honest errands that a warning, not a refusal, is the right answer.
 */

export const CHAT_WARNINGS = ['link', 'phone', 'account_number', 'pay_outside'] as const;
export type ChatWarning = (typeof CHAT_WARNINGS)[number];

/** What the apps show beside a message with each warning. */
export const CHAT_WARNING_TEXT: Record<ChatWarning, string> = {
  link: 'Be careful with links. Jiffo never asks you to sign in or pay through a link.',
  phone: 'Keep calls in the app: Jiffo connects you without either of you sharing a number.',
  account_number: 'Never send money to an account number from chat. Errands are paid only through Jiffo.',
  pay_outside: "Only pay through Jiffo. Money paid outside the app isn't protected and can't be refunded.",
};

/** Short names for staff, in the panel. */
export const CHAT_WARNING_LABELS: Record<ChatWarning, string> = {
  link: 'link',
  phone: 'phone number',
  account_number: 'account number',
  pay_outside: 'pay outside the app',
};

/** Endings of the web addresses people send, for one written without http or www. */
const TLDS = 'com|net|org|ng|io|co|me|app|link|xyz|info|biz|online|site|shop|store|ly|gl|to|tv|cc|top|live|page|africa';
const LINKS: RegExp[] = [
  /\bhttps?:\/\/\S+/i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  new RegExp(`\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(?![.-]?\\w)`, 'i'),
  new RegExp(`\\b[a-z0-9][a-z0-9-]*\\.(?:${TLDS})\\/\\S*`, 'i'),
];

/** Wallet apps people are asked to be paid into, in Nigeria. */
const WALLETS = 'opay|palmpay|moniepoint|kuda|paga';
const PAY_OUTSIDE: RegExp[] = [
  // "pay me directly", "I'll pay you cash", "pay outside".
  /\bpay\s+(?:(?:me|you|him|her|them|us)\s+)?(?:directly|direct|outside|cash|in\s+cash|privately|by\s+transfer|via\s+transfer|off[\s-]?(?:the\s+)?app)\b/i,
  // "transfer to my account", "send the money to my opay".
  new RegExp(
    `\\b(?:send|transfer|pay|credit|wire)\\b[^.!?\\n]{0,40}?\\b(?:to|into)\\s+(?:my|his|her|their|our)\\s+(?:bank\\s+|personal\\s+)?(?:account|acct|a\\/c|wallet|${WALLETS})\\b`,
    'i',
  ),
  // "do bank transfer to me".
  /\b(?:do|make|send)\s+(?:a\s+)?(?:bank\s+)?transfer\s+(?:to|into)\s+(?:me|my)\b/i,
  // "outside the app", "outside jiffo", "off the app".
  /\b(?:outside|off)\s+(?:of\s+)?(?:the\s+)?(?:app|jiffo)\b/i,
  // "don't pay in the app".
  /\b(?:don['’]?t|do\s+not|no\s+need\s+to)\s+pay\s+(?:in|on|through|via|with)\s+(?:the\s+)?(?:app|jiffo)\b/i,
  // "my opay".
  new RegExp(`\\bmy\\s+(?:${WALLETS})\\b`, 'i'),
];

/** A run of digits, with single spaces, dots or dashes between them, and a + in front if there is one. */
const DIGIT_RUN = /(?<![\w+])(\+\s?)?\d(?:[ .-]?\d)+(?!\w)/g;

/** What a run of digits looks like: a phone number, an account number, both, or neither (a price, say). */
function numberKinds(run: string, plus: boolean): ChatWarning[] {
  const digits = run.replace(/\D/g, '');
  if (plus) return digits.length >= 8 && digits.length <= 15 ? ['phone'] : [];
  if (digits.length === 13 && digits.startsWith('234')) return ['phone'];
  if (digits.length === 11 && digits.startsWith('0')) return ['phone'];
  // A bank account number (NUBAN) is ten digits; so is a Nigerian mobile number written without its 0.
  if (digits.length === 10) return /^[789][01]/.test(digits) ? ['phone', 'account_number'] : ['account_number'];
  return [];
}

/** The warnings for a message's text, each once, in a fixed order. */
export function chatWarnings(text: string): ChatWarning[] {
  const found = new Set<ChatWarning>();
  if (LINKS.some((p) => p.test(text))) found.add('link');
  for (const m of text.matchAll(DIGIT_RUN)) for (const kind of numberKinds(m[0], !!m[1])) found.add(kind);
  if (PAY_OUTSIDE.some((p) => p.test(text))) found.add('pay_outside');
  return CHAT_WARNINGS.filter((w) => found.has(w));
}

/** The warnings kept with a message, as its data holds them, ignoring anything this version doesn't know. */
export function warningsOf(data: { warnings?: unknown } | null | undefined): ChatWarning[] {
  const kept = Array.isArray(data?.warnings) ? data.warnings : [];
  return CHAT_WARNINGS.filter((w) => kept.includes(w));
}
