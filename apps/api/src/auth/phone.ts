import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { badRequest } from '../common/errors';

/** Turns what the person typed (0803..., 803..., +234803...) into E.164 and the number's country. */
export function normalisePhone(input: string, defaultCountry: string): { e164: string; country: string } {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid() || !parsed.country) {
    throw badRequest('invalid_phone', 'Enter a valid phone number');
  }
  return { e164: parsed.number, country: parsed.country };
}
