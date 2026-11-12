"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TermiiMessagingAdapter = exports.MemoryMessagingAdapter = exports.ConsoleMessagingAdapter = exports.MESSAGING = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
exports.MESSAGING = Symbol('MESSAGING');
const otpText = (code, ttlSeconds) => `Your Jiffo code is ${code}. It expires in ${Math.round(ttlSeconds / 60)} minutes. Never share it with anyone.`;
/** Development only: prints the code to the server log. */
class ConsoleMessagingAdapter {
    name = 'console';
    logger = new common_1.Logger('Messaging');
    async sendOtp(phone, code, ttlSeconds) {
        this.logger.log(`OTP for ${phone}: ${code} (valid ${ttlSeconds}s)`);
    }
}
exports.ConsoleMessagingAdapter = ConsoleMessagingAdapter;
/** Tests: keeps the codes in memory so a test can read them back. */
class MemoryMessagingAdapter {
    name = 'memory';
    sent = [];
    async sendOtp(phone, code) {
        this.sent.push({ phone, code });
    }
    lastCodeFor(phone) {
        return [...this.sent].reverse().find((m) => m.phone === phone)?.code;
    }
}
exports.MemoryMessagingAdapter = MemoryMessagingAdapter;
/** Termii SMS on the DND route, so codes reach numbers with do-not-disturb switched on. */
class TermiiMessagingAdapter {
    apiKey;
    senderId;
    baseUrl;
    fetchImpl;
    name = 'termii';
    constructor(apiKey, senderId, baseUrl, fetchImpl = fetch) {
        this.apiKey = apiKey;
        this.senderId = senderId;
        this.baseUrl = baseUrl;
        this.fetchImpl = fetchImpl;
    }
    async sendOtp(phone, code, ttlSeconds) {
        const res = await this.fetchImpl(`${this.baseUrl}/api/sms/send`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                api_key: this.apiKey,
                to: phone.replace(/^\+/, ''),
                from: this.senderId,
                sms: otpText(code, ttlSeconds),
                type: 'plain',
                channel: 'dnd',
            }),
        });
        if (!res.ok)
            throw (0, errors_1.unavailable)('sms_failed', 'We could not send the code. Try again in a moment.');
    }
}
exports.TermiiMessagingAdapter = TermiiMessagingAdapter;
//# sourceMappingURL=messaging.js.map