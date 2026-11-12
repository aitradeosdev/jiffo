"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ID_TYPE_KEYS = exports.ID_TYPES = void 0;
exports.normaliseIdNumber = normaliseIdNumber;
/** ID types the Nigeria country adapter knows. Another country adds its own. */
exports.ID_TYPES = {
    nin: { name: 'NIN slip or card', pattern: /^\d{11}$/ },
    bvn: { name: 'BVN', pattern: /^\d{11}$/ },
    drivers_licence: { name: "Driver's licence", pattern: /^[A-Z0-9]{9,14}$/ },
    voters_card: { name: "Voter's card (PVC)", pattern: /^[A-Z0-9]{19}$/ },
    passport: { name: 'International passport', pattern: /^[A-Z][0-9]{8}$|^[A-Z0-9]{8,9}$/ },
};
exports.ID_TYPE_KEYS = Object.keys(exports.ID_TYPES);
/** Strips spaces and checks an ID number against its type's format. */
function normaliseIdNumber(type, value) {
    const clean = value.replace(/\s+/g, '').toUpperCase();
    return exports.ID_TYPES[type].pattern.test(clean) ? clean : null;
}
//# sourceMappingURL=identity.js.map