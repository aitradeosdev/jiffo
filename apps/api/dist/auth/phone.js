"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalisePhone = normalisePhone;
const libphonenumber_js_1 = require("libphonenumber-js");
const errors_1 = require("../common/errors");
/** Turns what the person typed (0803..., 803..., +234803...) into E.164 and the number's country. */
function normalisePhone(input, defaultCountry) {
    const parsed = (0, libphonenumber_js_1.parsePhoneNumberFromString)(input.trim(), defaultCountry);
    if (!parsed || !parsed.isValid() || !parsed.country) {
        throw (0, errors_1.badRequest)('invalid_phone', 'Enter a valid phone number');
    }
    return { e164: parsed.number, country: parsed.country };
}
//# sourceMappingURL=phone.js.map