/**
 * Masking personal and bank details out of provider payloads and log lines (docs/security-plan.md, R10, S7).
 * Money is always re-read from the provider, so a stored or logged copy needs none of them.
 */

/** The words of a key, however it is written: customer_nin, ninNumber and NIN-Number all hold "nin". */
const wordsOf = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Words that mark a value as a person's number or address: BVN, NIN, phone, email, account number. */
const IDENTIFIERS = new Set(['bvn', 'nin', 'phone', 'mobile', 'msisdn', 'email', 'nuban', 'iban', 'accountnumber']);
/** Words that mark an object as being about a person, so a name inside it is theirs. */
const PEOPLE = new Set([
  'customer',
  'sender',
  'recipient',
  'receiver',
  'holder',
  'payer',
  'beneficiary',
  'owner',
  'originator',
  'user',
]);

type Kind = 'identifier' | 'name' | null;

function kindOf(key: string, personal: boolean): Kind {
  const words = wordsOf(key);
  const joined = words.join('');
  if (
    words.some((w) => IDENTIFIERS.has(w)) ||
    joined.includes('accountnumber') ||
    joined.includes('accountno') ||
    (words.includes('bank') && words.includes('account'))
  ) {
    return 'identifier';
  }
  // first_name, account_name, sender_name; or any name inside a person's block (customer.name).
  if (
    words.includes('name') &&
    (personal ||
      words.some(
        (w) => PEOPLE.has(w) || w === 'account' || w === 'first' || w === 'last' || w === 'middle' || w === 'full',
      ))
  ) {
    return 'name';
  }
  return null;
}

/** A number kept only by its last four characters, so a record can still be matched by eye. */
const maskIdentifier = (text: string) => (text.length <= 4 ? '****' : `****${text.slice(-4)}`);
/** A name kept only by its initials. */
const maskName = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]}***`)
    .join(' ');

/** Every value inside, masked the same way: an object under a sensitive key is sensitive throughout. */
function maskAll(value: unknown, kind: Exclude<Kind, null>): unknown {
  if (Array.isArray(value)) return value.map((v) => maskAll(v, kind));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskAll(v, kind)]));
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    // A name or email kept under a bank or phone key is masked as words, not by its last characters.
    return kind === 'name' || /[A-Za-z]/.test(text) ? maskName(text) : maskIdentifier(text);
  }
  return value;
}

function walk(value: unknown, personal: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, personal));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const kind = kindOf(key, personal);
    out[key] = kind ? maskAll(inner, kind) : walk(inner, personal || wordsOf(key).some((w) => PEOPLE.has(w)));
  }
  return out;
}

/** A copy of a provider's payload with personal and bank details masked, for storing. */
export function redact<T>(value: T): T {
  return walk(value, false) as T;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Ten or more digits in a row, maybe after a +: account numbers, BVNs, NINs, phone numbers. */
const LONG_NUMBER = /\+?\b\d{10,}\b/g;

/** A log line with emails and long numbers masked: provider messages can quote an account or phone number. */
export function scrub(text: string): string {
  return text.replace(EMAIL, '****@****').replace(LONG_NUMBER, (n) => maskIdentifier(n));
}
