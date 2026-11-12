import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { badRequest } from '../common/errors';

const SMS_CAPABLE = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE']);

/**
 * Turns what the person typed (0803..., 803..., +234803...) into E.164 and the number's country.
 * Only mobile numbers: a code sent to a landline costs money and never arrives.
 */
export function normalisePhone(input: string, defaultCountry: string): { e164: string; country: string } {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid() || !parsed.country) {
    throw badRequest('invalid_phone', 'Enter a valid phone number');
  }
  if (!SMS_CAPABLE.has(parsed.getType() ?? '')) throw badRequest('invalid_phone', 'Enter a mobile number');
  return { e164: parsed.number, country: parsed.country };
}
