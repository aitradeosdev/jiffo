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
exports.ErrandsService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@jiffo/shared");
const app_config_1 = require("../config/app-config");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const countries_service_1 = require("../countries/countries.service");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const errand_timers_1 = require("../timers/errand-timers");
const errand_notifier_1 = require("./errand-notifier");
const errand_input_1 = require("./errand-input");
const errand_view_1 = require("./errand-view");
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
let ErrandsService = class ErrandsService {
    db;
    config;
    timers;
    countries;
    notifier;
    constructor(db, config, timers, countries, notifier) {
        this.db = db;
        this.config = config;
        this.timers = timers;
        this.countries = countries;
        this.notifier = notifier;
    }
    onModuleInit() {
        this.timers.setHandler((job) => this.applyTimer(job));
    }
    /* ---------- Reading ---------- */
    roleFor(errand, auth) {
        if (auth.app === 'customer')
            return errand.customerId === auth.userId ? 'customer' : null;
        if (errand.agentId === auth.userId)
            return 'agent';
        if (errand.status === 'requested' && errand.customerId !== auth.userId)
            return 'prospect';
        return null;
    }
    async people(rows) {
        const ids = [...new Set(rows.flatMap((r) => [r.customerId, r.agentId]).filter((id) => !!id))];
        const found = ids.length
            ? await this.db.select({ id: schema_1.users.id, firstName: schema_1.users.firstName }).from(schema_1.users).where((0, drizzle_orm_1.inArray)(schema_1.users.id, ids))
            : [];
        return new Map(found.map((u) => [u.id, u]));
    }
    async views(rows, roleOf) {
        if (rows.length === 0)
            return [];
        const ids = rows.map((r) => r.id);
        const [stops, people] = await Promise.all([
            this.db.select().from(schema_1.errandStops).where((0, drizzle_orm_1.inArray)(schema_1.errandStops.errandId, ids)),
            this.people(rows),
        ]);
        const stopsBy = new Map();
        for (const s of stops)
            stopsBy.set(s.errandId, [...(stopsBy.get(s.errandId) ?? []), s]);
        return rows.map((r) => (0, errand_view_1.errandView)(r, stopsBy.get(r.id) ?? [], { customer: people.get(r.customerId) ?? null, agent: r.agentId ? (people.get(r.agentId) ?? null) : null }, roleOf(r)));
    }
    async load(errandId, auth) {
        const [errand] = await this.db.select().from(schema_1.errands).where((0, drizzle_orm_1.eq)(schema_1.errands.id, errandId));
        const role = errand ? this.roleFor(errand, auth) : null;
        if (!errand || !role)
            throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
        return { errand, role };
    }
    async get(errandId, auth) {
        const { errand, role } = await this.load(errandId, auth);
        const [view] = await this.views([errand], () => role);
        return view;
    }
    /** The caller's own errands: as the customer in the customer app, as the agent in the agent app. */
    async listMine(auth, before, limit) {
        const mine = auth.app === 'customer' ? (0, drizzle_orm_1.eq)(schema_1.errands.customerId, auth.userId) : (0, drizzle_orm_1.eq)(schema_1.errands.agentId, auth.userId);
        const rows = await this.db
            .select()
            .from(schema_1.errands)
            .where((0, drizzle_orm_1.and)(mine, before ? (0, drizzle_orm_1.lt)(schema_1.errands.createdAt, before) : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.errands.createdAt))
            .limit(limit);
        return this.views(rows, () => (auth.app === 'customer' ? 'customer' : 'agent'));
    }
    /** Open errands whose pickup is within the radius, nearest first. */
    async board(auth, q) {
        const [me] = await this.db.select({ countryCode: schema_1.users.countryCode }).from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, auth.userId));
        const here = (0, drizzle_orm_1.sql) `ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography`;
        const distance = (0, drizzle_orm_1.sql) `ST_Distance(${schema_1.errandStops.location}, ${here})`;
        const rows = await this.db
            .select({ errand: schema_1.errands, distanceMeters: distance })
            .from(schema_1.errands)
            .innerJoin(schema_1.errandStops, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandStops.errandId, schema_1.errands.id), (0, drizzle_orm_1.eq)(schema_1.errandStops.seq, 0)))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errands.status, 'requested'), (0, drizzle_orm_1.eq)(schema_1.errands.countryCode, me.countryCode), (0, drizzle_orm_1.ne)(schema_1.errands.customerId, auth.userId), (0, drizzle_orm_1.sql) `ST_DWithin(${schema_1.errandStops.location}, ${here}, ${q.radiusKm * 1000})`))
            .orderBy(distance)
            .limit(q.limit);
        const views = await this.views(rows.map((r) => r.errand), () => 'prospect');
        return views.map((v, i) => ({ ...v, distanceMeters: Math.round(Number(rows[i].distanceMeters)) }));
    }
    async events(errandId, auth) {
        const { role } = await this.load(errandId, auth);
        if (role === 'prospect')
            throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
        const rows = await this.db
            .select()
            .from(schema_1.errandEvents)
            .where((0, drizzle_orm_1.eq)(schema_1.errandEvents.errandId, errandId))
            .orderBy(schema_1.errandEvents.id);
        return rows.map((e) => ({
            id: e.id,
            event: e.event,
            fromStatus: e.fromStatus,
            toStatus: e.toStatus,
            actorRole: e.actorRole,
            data: e.data,
            createdAt: e.createdAt,
        }));
    }
    /** The customer's hand-off PIN. Shown only once the agent has marked the errand delivered. */
    async pin(errandId, auth) {
        const { errand, role } = await this.load(errandId, auth);
        if (role !== 'customer')
            throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
        if (!(0, shared_1.canRevealPin)(errand.status) || !errand.pinCipher) {
            throw (0, errors_1.conflict)('pin_not_available', 'Your PIN shows once the agent marks the errand delivered');
        }
        return { pin: (0, crypto_1.decrypt)(this.config.PIN_KEY, errand.pinCipher) };
    }
    /* ---------- Creating ---------- */
    async create(auth, input) {
        const [customer] = await this.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, auth.userId));
        if (!customer?.firstName)
            throw (0, errors_1.conflict)('profile_incomplete', 'Add your name before sending an errand');
        const country = customer.countryCode;
        const [{ version, settings }, state, category] = await Promise.all([
            this.countries.currentSettings(country),
            this.countries.enabledState(country, input.stateCode),
            this.countries.activeCategory(country, input.categoryKey),
        ]);
        if (!state)
            throw (0, errors_1.unprocessable)('state_not_available', 'Jiffo is not available in this state yet');
        if (!category)
            throw (0, errors_1.unprocessable)('category_not_available', 'This category is not available');
        if (input.feeKobo < settings.pricing.minFeeKobo) {
            throw (0, errors_1.unprocessable)('fee_too_low', 'The fee is below the minimum', { minFeeKobo: settings.pricing.minFeeKobo });
        }
        if (input.scheduledFor && input.scheduledFor.getTime() < Date.now() + 15 * MINUTE_MS) {
            throw (0, errors_1.unprocessable)('schedule_too_soon', 'Schedule at least 15 minutes ahead, or send it now');
        }
        const created = await this.db.transaction(async (tx) => {
            const [errand] = await tx
                .insert(schema_1.errands)
                .values({
                countryCode: country,
                stateCode: state.code,
                customerId: customer.id,
                categoryKey: category.key,
                buy: input.buy ?? category.buyDefault,
                urgent: input.urgent,
                description: input.description,
                status: 'requested',
                feeKobo: input.feeKobo,
                scheduledFor: input.scheduledFor ?? null,
                settingsVersion: version,
            })
                .returning();
            await tx.insert(schema_1.errandStops).values(input.stops.map((s, seq) => ({
                errandId: errand.id,
                seq,
                kind: s.kind,
                label: s.label ?? null,
                address: s.address,
                lat: s.lat,
                lng: s.lng,
                location: (0, drizzle_orm_1.sql) `ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)::geography`,
            })));
            await tx.insert(schema_1.errandEvents).values({
                errandId: errand.id,
                event: 'create',
                fromStatus: null,
                toStatus: 'requested',
                actorRole: 'customer',
                actorId: customer.id,
            });
            return errand;
        });
        await this.scheduleTimers(created, settings);
        return this.get(created.id, auth);
    }
    /* ---------- Changing ---------- */
    /** Runs one event from the customer or agent app through the state machine. */
    async transition(errandId, auth, input) {
        const outcome = await this.db.transaction(async (tx) => {
            const [errand] = await tx.select().from(schema_1.errands).where((0, drizzle_orm_1.eq)(schema_1.errands.id, errandId)).for('update');
            const role = errand ? this.roleFor(errand, auth) : null;
            if (!errand || !role)
                throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
            if (role === 'prospect' && input.event !== 'accept')
                throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
            if (input.version !== undefined && input.version !== errand.version) {
                throw (0, errors_1.conflict)('errand_changed', 'This errand changed. Refresh and try again.', { version: errand.version });
            }
            const actor = role === 'customer' ? 'customer' : 'agent';
            const to = (0, shared_1.nextState)(errand.status, input.event, {
                actor,
                buy: errand.buy,
                pendingOffer: errand.pendingOfferKobo !== null,
            });
            const event = input.event;
            const settings = await this.countries.settingsAt(errand.countryCode, errand.settingsVersion);
            const effect = await this.effectOf(tx, event, errand, auth, input.data, settings);
            if (effect instanceof errors_1.ApiError)
                return { error: effect };
            const after = await this.write(tx, errand, event, to, effect, actor, auth.userId);
            return { result: { before: errand, after, event, record: effect.record, settings } };
        });
        if ('error' in outcome)
            throw outcome.error;
        await this.afterCommit(outcome.result);
        return this.get(errandId, auth);
    }
    /** A timer came due. It applies only if the errand has not moved since the timer was set. */
    async applyTimer(job) {
        const result = await this.db.transaction(async (tx) => {
            const [errand] = await tx.select().from(schema_1.errands).where((0, drizzle_orm_1.eq)(schema_1.errands.id, job.errandId)).for('update');
            if (!errand || errand.version !== job.version || errand.status !== job.status)
                return null;
            const to = (0, shared_1.nextState)(errand.status, job.event, {
                actor: 'system',
                buy: errand.buy,
                pendingOffer: errand.pendingOfferKobo !== null,
            });
            const settings = await this.countries.settingsAt(errand.countryCode, errand.settingsVersion);
            const effect = { patch: {}, record: { timer: true } };
            const after = await this.write(tx, errand, job.event, to, effect, 'system', null);
            return {
                before: errand,
                after,
                event: job.event,
                record: effect.record,
                settings,
            };
        });
        if (result)
            await this.afterCommit(result);
    }
    async write(tx, errand, event, to, effect, actorRole, actorId) {
        const now = new Date();
        const [after] = await tx
            .update(schema_1.errands)
            .set({
            ...effect.patch,
            status: to,
            version: errand.version + 1,
            updatedAt: now,
            ...(to === 'completed' ? { completedAt: now } : {}),
            ...(to === 'cancelled' ? { cancelledAt: now } : {}),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errands.id, errand.id), (0, drizzle_orm_1.eq)(schema_1.errands.version, errand.version)))
            .returning();
        if (!after)
            throw (0, errors_1.conflict)('errand_changed', 'This errand changed. Refresh and try again.');
        await tx.insert(schema_1.errandEvents).values({
            errandId: errand.id,
            event,
            fromStatus: errand.status,
            toStatus: to,
            actorRole,
            actorId,
            data: effect.record,
        });
        return after;
    }
    parse(event, data) {
        const parsed = errand_input_1.EVENT_DATA[event].safeParse(data);
        if (!parsed.success) {
            throw (0, errors_1.badRequest)('invalid_request', 'The request is not valid', {
                issues: parsed.error.issues.map((i) => ({ path: ['data', ...i.path].join('.'), message: i.message })),
            });
        }
        return parsed.data;
    }
    /**
     * The checks and field changes for one event. Returns an ApiError (instead of throwing) when the
     * refusal must still be saved, such as a wrong PIN counting towards the limit.
     */
    async effectOf(tx, event, errand, auth, data, settings) {
        const now = new Date();
        const releaseAgent = {
            agentId: null,
            pinCipher: null,
            pinAttempts: 0,
            pendingOfferKobo: null,
            acceptedAt: null,
        };
        switch (event) {
            case 'accept': {
                const [agent] = await tx.select({ firstName: schema_1.users.firstName }).from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, auth.userId));
                if (!agent?.firstName)
                    throw (0, errors_1.conflict)('profile_incomplete', 'Add your name before accepting errands');
                const pin = (0, crypto_1.numericCode)(4);
                return {
                    patch: {
                        agentId: auth.userId,
                        acceptedAt: now,
                        pinCipher: (0, crypto_1.encrypt)(this.config.PIN_KEY, pin),
                        pinAttempts: 0,
                    },
                    record: { agentId: auth.userId },
                };
            }
            case 'withdraw':
            case 'release_agent':
                return { patch: releaseAgent, record: { agentId: errand.agentId } };
            case 'cancel':
                return { patch: { pendingOfferKobo: null }, record: this.parse('cancel', data) };
            case 'send_offer': {
                const { amountKobo } = this.parse('send_offer', data);
                if (amountKobo === errand.feeKobo)
                    throw (0, errors_1.unprocessable)('offer_unchanged', 'The new price is the same as the current fee');
                if (amountKobo < settings.pricing.minFeeKobo) {
                    throw (0, errors_1.unprocessable)('fee_too_low', 'The fee is below the minimum', {
                        minFeeKobo: settings.pricing.minFeeKobo,
                    });
                }
                return { patch: { pendingOfferKobo: amountKobo }, record: { amountKobo, previousFeeKobo: errand.feeKobo } };
            }
            case 'accept_offer':
                return {
                    patch: { feeKobo: errand.pendingOfferKobo, pendingOfferKobo: null },
                    record: { amountKobo: errand.pendingOfferKobo, previousFeeKobo: errand.feeKobo },
                };
            case 'decline_offer':
                return { patch: { pendingOfferKobo: null }, record: { amountKobo: errand.pendingOfferKobo } };
            case 'start':
                return { patch: { startedAt: now }, record: {} };
            case 'send_item_amount': {
                const { amountKobo, photos } = this.parse('send_item_amount', data);
                return { patch: { itemAmountKobo: amountKobo }, record: { amountKobo, photos } };
            }
            case 'mark_delivered':
                return { patch: { deliveredAt: now }, record: {} };
            case 'confirm_pin': {
                const { pin } = this.parse('confirm_pin', data);
                const limit = settings.limits.pinAttempts;
                if (errand.pinAttempts >= limit) {
                    throw (0, errors_1.locked)('pin_locked', 'Too many wrong PINs. Send a drop-off photo instead, or contact support.');
                }
                const actual = errand.pinCipher ? (0, crypto_1.decrypt)(this.config.PIN_KEY, errand.pinCipher) : null;
                if (!actual || !(0, crypto_1.safeEqual)(actual, pin)) {
                    const attempts = errand.pinAttempts + 1;
                    await tx.update(schema_1.errands).set({ pinAttempts: attempts }).where((0, drizzle_orm_1.eq)(schema_1.errands.id, errand.id));
                    return (0, errors_1.unprocessable)('wrong_pin', 'That PIN is not right', { attemptsLeft: Math.max(0, limit - attempts) });
                }
                return { patch: {}, record: { method: 'pin' } };
            }
            case 'send_dropoff_photo':
                return { patch: {}, record: this.parse('send_dropoff_photo', data) };
            case 'report_unreachable':
                return { patch: {}, record: this.parse('report_unreachable', data) };
            case 'open_dispute':
                return { patch: { pendingOfferKobo: null }, record: { ...this.parse('open_dispute', data), by: auth.app } };
            default:
                return { patch: {}, record: {} };
        }
    }
    async afterCommit(result) {
        await this.scheduleTimers(result.after, result.settings);
        await this.notifier.transitioned(result);
    }
    /** Sets the system timer for the state the errand just entered, if that state has one. */
    async scheduleTimers(errand, settings) {
        const t = settings.timers;
        const plan = {
            item_pending: ['item_lock_timeout', t.itemLockMinutes * MINUTE_MS],
            photo_pending: ['auto_release', t.autoReleaseHours * HOUR_MS],
            unreachable: ['unreachable_timeout', t.unreachableHours * HOUR_MS],
            ...(errand.urgent
                ? { requested: ['expire', t.urgentExpiryMinutes * MINUTE_MS] }
                : {}),
        };
        const due = plan[errand.status];
        if (!due)
            return;
        await this.timers.schedule({ errandId: errand.id, event: due[0], status: errand.status, version: errand.version }, due[1]);
    }
};
exports.ErrandsService = ErrandsService;
exports.ErrandsService = ErrandsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __param(1, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __param(2, (0, common_1.Inject)(errand_timers_1.ERRAND_TIMERS)),
    __metadata("design:paramtypes", [Object, Object, Object, countries_service_1.CountriesService,
        errand_notifier_1.ErrandNotifier])
], ErrandsService);
//# sourceMappingURL=errands.service.js.map