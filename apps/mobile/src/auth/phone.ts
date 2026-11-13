/**
 * Phone input for any country. The app only tidies what was typed; the server checks the number
 * properly (and that it is a mobile) for the country's prefix from the country config.
 */

/** What the person typed, as national digits: the country prefix and one leading 0 removed. */
export function nationalDigits(input: string, prefix: string): string {
  const prefixDigits = prefix.replace(/\D/g, '');
  let d = input.replace(/\D/g, '');
  if (input.trim().startsWith('+') || (d.startsWith(prefixDigits) && d.length > 10)) {
    if (d.startsWith(prefixDigits)) d = d.slice(prefixDigits.length);
  }
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 12);
}

/** Long enough to be worth sending to the server. */
export const plausibleNumber = (digits: string) => digits.length >= 7;

/** 8031234567 → "803 123 4567". */
export function formatNational(digits: string): string {
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean).join(' ');
}

export const toE164 = (prefix: string, digits: string) => `${prefix}${digits}`;

/** +2348031234567 → "+234 803 123 4567", for showing a number back to the person. */
export function formatE164(phone: string, prefix: string): string {
  return phone.startsWith(prefix) ? `${prefix} ${formatNational(phone.slice(prefix.length))}` : phone;
}
