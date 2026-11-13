/** Nigerian mobile numbers as people type them: 0803 123 4567, 803 123 4567 or +234 803 123 4567. */
export function nationalDigits(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('234')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

/** Ten national digits starting 7, 8 or 9 (the mobile ranges). The server does the full check. */
export const looksLikeMobile = (digits: string) => /^[789]\d{9}$/.test(digits);

/** 8031234567 → "803 123 4567". */
export function formatNational(digits: string): string {
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean);
  return parts.join(' ');
}

export const toE164 = (digits: string) => `+234${digits}`;

/** +2348031234567 → "+234 803 123 4567", for showing a number back to the person. */
export function formatE164(phone: string): string {
  return phone.startsWith('+234') ? `+234 ${formatNational(phone.slice(4))}` : phone;
}
