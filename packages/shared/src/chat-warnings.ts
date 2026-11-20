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
const LINKS: RegExp[] = [/\bhttps?:\/\/\S+/i, /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i];
/**
 * An address written without http or www, such as paystack.shop/pay or wa.me/234...; its ending is captured.
 * Not the part of an email address after the @.
 */
const BARE_ADDRESS = new RegExp(`(?<![@\\w.-])[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(${TLDS})(?![\\w-]|\\.\\w)`, 'gi');

function hasLink(text: string) {
  if (LINKS.some((p) => p.test(text))) return true;
  for (const m of text.matchAll(BARE_ADDRESS)) {
    // "Thanks.Me too" is one sentence run into the next, not an address.
    if (!/^[A-Z][a-z]+$/.test(m[1]!)) return true;
  }
  return false;
}

/** Wallet apps people are asked to be paid into, in Nigeria. */
const WALLETS = 'opay|palmpay|moniepoint|kuda|paga';
/**
 * Asking the other side to pay, or be paid, outside the app. The payee is "me", "us" or "you", or the account
 * is "my" or "our": an agent paying the shop in cash or by transfer, as errands need, isn't warned about.
 */
const PAY_OUTSIDE: RegExp[] = [
  // "pay me directly", "I'll pay you cash".
  /\bpay\s+(?:me|us|you)\s+(?:directly|direct|cash|in\s+cash|privately|by\s+transfer|via\s+transfer)\b/i,
  // "transfer to my account", "send the money to my opay".
  new RegExp(
    `\\b(?:send|transfer|pay|credit|wire)\\b[^.!?\\n]{0,40}?\\b(?:to|into)\\s+(?:my|our)\\s+(?:bank\\s+|personal\\s+)?(?:account|acct|a\\/c|wallet|${WALLETS})\\b`,
    'i',
  ),
  // "do bank transfer to me".
  /\b(?:do|make|send)\s+(?:a\s+)?(?:bank\s+)?transfer\s+(?:to|into)\s+(?:me|my|us|our)\b/i,
  // "outside the app", "pay outside jiffo", "off the app".
  /\b(?:outside|off)\s+(?:of\s+)?(?:the\s+)?(?:app|jiffo)\b/i,
  // "don't pay in the app".
  /\b(?:don['’]?t|do\s+not|no\s+need\s+to)\s+pay\s+(?:in|on|through|via|with)\s+(?:the\s+)?(?:app|jiffo)\b/i,
  // "my opay".
  new RegExp(`\\bmy\\s+(?:${WALLETS})\\b`, 'i'),
];

/**
 * Each whole group of digits, unless a unit follows it (1.5kg, 10am). Letters before don't stop one being
 * read (GTB0123456789).
 */
const DIGIT_GROUP = /(?<!\d)\d+(?![A-Za-z\d])/g;
/** What may come between the groups of one number: a space, dot or dash, and brackets, as in (0803) 123-4567. */
const JOINER = /^[ ()]{0,2}[.-]?[ ()]{0,2}$/;
/** The most groups one number is read from. */
const MAX_GROUPS = 6;

/** What some digits are: a phone number, an account number, both, or neither (a price, say). */
function numberKinds(digits: string, plus: boolean): ChatWarning[] {
  if (plus) return digits.length >= 8 && digits.length <= 15 ? ['phone'] : [];
  if (digits.length === 13 && digits.startsWith('234')) return ['phone'];
  if (digits.length === 11 && digits.startsWith('0')) return ['phone'];
  // A bank account number (NUBAN) is ten digits; so is a Nigerian mobile number written without its 0.
  if (digits.length === 10) return /^[789][01]/.test(digits) ? ['phone', 'account_number'] : ['account_number'];
  return [];
}

/**
 * The phone and account numbers in the text. From each group of digits, the longest run of joined groups
 * that reads as a number is taken, then the search goes on after it: so a number just after another one
 * ("buy 2 08031234567") is still found, and the end of a whole number isn't read as a second one.
 */
function numberWarnings(text: string): ChatWarning[] {
  const groups = [...text.matchAll(DIGIT_GROUP)].map((m) => ({
    digits: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
  const out: ChatWarning[] = [];
  let i = 0;
  while (i < groups.length) {
    const plus = /\+\s?$/.test(text.slice(Math.max(0, groups[i]!.start - 2), groups[i]!.start));
    let digits = '';
    let best: { last: number; kinds: ChatWarning[] } | null = null;
    for (let j = i; j < groups.length && j < i + MAX_GROUPS; j++) {
      if (j > i && !JOINER.test(text.slice(groups[j - 1]!.end, groups[j]!.start))) break;
      digits += groups[j]!.digits;
      const kinds = numberKinds(digits, plus);
      if (kinds.length) best = { last: j, kinds };
    }
    if (best) out.push(...best.kinds);
    i = best ? best.last + 1 : i + 1;
  }
  return out;
}

/** The warnings for a message's text, each once, in a fixed order. */
export function chatWarnings(text: string): ChatWarning[] {
  const found = new Set<ChatWarning>(numberWarnings(text));
  if (hasLink(text)) found.add('link');
  if (PAY_OUTSIDE.some((p) => p.test(text))) found.add('pay_outside');
  return CHAT_WARNINGS.filter((w) => found.has(w));
}

/** The warnings kept with a message, as its data holds them, ignoring anything this version doesn't know. */
export function warningsOf(data: { warnings?: unknown } | null | undefined): ChatWarning[] {
  const kept = Array.isArray(data?.warnings) ? data.warnings : [];
  return CHAT_WARNINGS.filter((w) => kept.includes(w));
}
