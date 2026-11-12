"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeGateway = void 0;
const common_1 = require("@nestjs/common");
const websockets_1 = require("@nestjs/websockets");
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const auth_guard_1 = require("../auth/auth.guard");
const userRoom = (userId, app) => `user:${userId}:${app}`;
const errandRoom = (errandId) => `errand:${errandId}`;
const SubscribeBody = zod_1.z.object({ errandId: zod_1.z.string().uuid() });
/**
 * One socket per signed-in app. Clients join their own user room on connect and subscribe to the
 * errands they are part of. Tokens go in the handshake: io(url + '/realtime', { auth: { token } }).
 */
let RealtimeGateway = class RealtimeGateway {
    verifier;
    db;
    server;
    constructor(verifier, db) {
        this.verifier = verifier;
        this.db = db;
    }
    async handleConnection(client) {
        try {
            const token = client.handshake.auth?.token;
            if (typeof token !== 'string')
                throw new Error('missing token');
            const auth = await this.verifier.verify(token);
            client.data.auth = auth;
            await client.join(userRoom(auth.userId, auth.app));
            client.emit('ready', { userId: auth.userId, app: auth.app });
        }
        catch {
            client.emit('auth_error', { code: 'invalid_token', message: 'Sign in again' });
            client.disconnect(true);
        }
    }
    async subscribe(client, body) {
        const auth = client.data.auth;
        const parsed = SubscribeBody.safeParse(body);
        if (!auth || !parsed.success)
            return { ok: false, error: { code: 'invalid_request', message: 'Send an errandId' } };
        const [errand] = await this.db
            .select({ customerId: schema_1.errands.customerId, agentId: schema_1.errands.agentId })
            .from(schema_1.errands)
            .where((0, drizzle_orm_1.eq)(schema_1.errands.id, parsed.data.errandId));
        const allowed = !!errand &&
            ((auth.app === 'customer' && errand.customerId === auth.userId) ||
                (auth.app === 'agent' && errand.agentId === auth.userId));
        if (!allowed)
            return { ok: false, error: { code: 'errand_not_found', message: 'Errand not found' } };
        await client.join(errandRoom(parsed.data.errandId));
        return { ok: true };
    }
    async unsubscribe(client, body) {
        const parsed = SubscribeBody.safeParse(body);
        if (parsed.success)
            await client.leave(errandRoom(parsed.data.errandId));
        return { ok: true };
    }
    toErrand(errandId, event, payload) {
        this.server?.to(errandRoom(errandId)).emit(event, payload);
    }
    toUser(userId, app, event, payload) {
        this.server?.to(userRoom(userId, app)).emit(event, payload);
    }
    /** An agent who left an errand stops receiving its updates straight away. */
    removeFromErrand(userId, app, errandId) {
        this.server?.in(userRoom(userId, app)).socketsLeave(errandRoom(errandId));
    }
    /** Drops sockets whose session just ended (logout, or "sign out other phones"). */
    disconnectWhere(match) {
        if (!this.server)
            return;
        for (const socket of this.server.sockets.values()) {
            const auth = socket.data.auth;
            if (auth && match(auth))
                socket.disconnect(true);
        }
    }
};
exports.RealtimeGateway = RealtimeGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", Function)
], RealtimeGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('errand.subscribe'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], RealtimeGateway.prototype, "subscribe", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('errand.unsubscribe'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], RealtimeGateway.prototype, "unsubscribe", null);
exports.RealtimeGateway = RealtimeGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({ namespace: '/realtime', cors: { origin: '*' } }),
    __param(1, (0, common_1.Inject)(database_module_1.DB)),
    __metadata("design:paramtypes", [auth_guard_1.SessionVerifier, Object])
], RealtimeGateway);
//# sourceMappingURL=realtime.gateway.js.map