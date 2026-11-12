"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomToken = exports.numericCode = exports.hmacSha256 = exports.sha256 = void 0;
exports.safeEqual = safeEqual;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const node_crypto_1 = require("node:crypto");
const sha256 = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
exports.sha256 = sha256;
const hmacSha256 = (secret, value) => (0, node_crypto_1.createHmac)('sha256', secret).update(value).digest('hex');
exports.hmacSha256 = hmacSha256;
/** Compares two strings in constant time, so a wrong guess takes as long as a right one. */
function safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && (0, node_crypto_1.timingSafeEqual)(left, right);
}
/** A numeric code with leading zeros kept, e.g. "004217". */
const numericCode = (digits) => (0, node_crypto_1.randomInt)(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
exports.numericCode = numericCode;
const randomToken = (bytes = 32) => (0, node_crypto_1.randomBytes)(bytes).toString('base64url');
exports.randomToken = randomToken;
/** AES-256-GCM. The output is iv.tag.ciphertext, each base64url. Used for hand-off PINs the customer must be able to see. */
function encrypt(keyHex, plaintext) {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
function decrypt(keyHex, sealed) {
    const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !body)
        throw new Error('Malformed ciphertext');
    const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
//# sourceMappingURL=crypto.js.map