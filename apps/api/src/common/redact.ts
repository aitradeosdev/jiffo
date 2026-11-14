/** Keys whose values identify a person or their bank: account numbers, BVN, NIN, phone, email. */
const SENSITIVE = /(account_?number|accountnumber|bank_account|bvn|\bnin\b|phone|mobile|msisdn|email)/i;

/** A value kept only by its last four characters, so a record can still be matched by eye. */
const mask = (value: unknown) => {
  const text = String(value ?? '');
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
};

/**
 * A copy of a provider's payload with personal and bank details masked, for storing (docs/security-plan.md,
 * R10): the money is always re-read from the provider, so the stored copy needs none of them.
 */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] =
      SENSITIVE.test(key) && (typeof inner === 'string' || typeof inner === 'number') ? mask(inner) : redact(inner);
  }
  return out as T;
}
