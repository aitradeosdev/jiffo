"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FcmPushAdapter = exports.MemoryPushAdapter = exports.ConsolePushAdapter = exports.PUSH = void 0;
const common_1 = require("@nestjs/common");
const jose_1 = require("jose");
exports.PUSH = Symbol('PUSH');
class ConsolePushAdapter {
    name = 'console';
    logger = new common_1.Logger('Push');
    async send(tokens, n) {
        this.logger.log(`Push to ${tokens.length} device(s): ${n.title} — ${n.body}`);
        return { invalidTokens: [] };
    }
}
exports.ConsolePushAdapter = ConsolePushAdapter;
class MemoryPushAdapter {
    name = 'memory';
    sent = [];
    /** Tokens to report as dead, for tests of token clean-up. */
    dead = new Set();
    async send(tokens, n) {
        for (const token of tokens)
            this.sent.push({ token, ...n });
        return { invalidTokens: tokens.filter((t) => this.dead.has(t)) };
    }
}
exports.MemoryPushAdapter = MemoryPushAdapter;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Firebase Cloud Messaging, HTTP v1 API, authenticated with a service account. */
class FcmPushAdapter {
    fetchImpl;
    name = 'fcm';
    account;
    accessToken = null;
    logger = new common_1.Logger('FcmPush');
    constructor(serviceAccountJson, fetchImpl = fetch) {
        this.fetchImpl = fetchImpl;
        const parsed = JSON.parse(serviceAccountJson);
        if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
            throw new Error('FCM_SERVICE_ACCOUNT_JSON must include project_id, client_email and private_key');
        }
        this.account = parsed;
    }
    async token() {
        if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000)
            return this.accessToken.value;
        const key = await (0, jose_1.importPKCS8)(this.account.private_key, 'RS256');
        const assertion = await new jose_1.SignJWT({ scope: FCM_SCOPE })
            .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
            .setIssuer(this.account.client_email)
            .setAudience(GOOGLE_TOKEN_URL)
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(key);
        const res = await this.fetchImpl(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        });
        if (!res.ok)
            throw new Error(`FCM auth failed with ${res.status}`);
        const body = (await res.json());
        this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
        return body.access_token;
    }
    async send(tokens, n) {
        if (tokens.length === 0)
            return { invalidTokens: [] };
        const accessToken = await this.token();
        const url = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;
        const invalidTokens = [];
        await Promise.all(tokens.map(async (token) => {
            const res = await this.fetchImpl(url, {
                method: 'POST',
                headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    message: {
                        token,
                        notification: { title: n.title, body: n.body },
                        data: n.data ?? {},
                        android: { priority: 'high' },
                        apns: { headers: { 'apns-priority': '10' } },
                    },
                }),
            });
            if (res.ok)
                return;
            const detail = await res.text();
            if (res.status === 404 ||
                detail.includes('UNREGISTERED') ||
                detail.includes('registration-token-not-registered')) {
                invalidTokens.push(token);
            }
            else {
                this.logger.warn(`FCM send failed with ${res.status}: ${detail.slice(0, 200)}`);
            }
        }));
        return { invalidTokens };
    }
}
exports.FcmPushAdapter = FcmPushAdapter;
//# sourceMappingURL=push.js.map