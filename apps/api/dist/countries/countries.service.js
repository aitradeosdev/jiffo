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
exports.CountriesService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@jiffo/shared");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const errors_1 = require("../common/errors");
/**
 * The country adapter: everything that differs by country (currency, states, categories, fees, timers,
 * identity rules) is read through here, never hard-coded.
 */
let CountriesService = class CountriesService {
    db;
    constructor(db) {
        this.db = db;
    }
    async enabledCountry(code) {
        const [country] = await this.db.select().from(schema_1.countries).where((0, drizzle_orm_1.eq)(schema_1.countries.code, code.toUpperCase()));
        if (!country || !country.enabled)
            throw (0, errors_1.notFound)('country_not_available', 'Jiffo is not available in this country yet');
        return country;
    }
    async currentSettings(countryCode) {
        const [row] = await this.db
            .select()
            .from(schema_1.settingsVersions)
            .where((0, drizzle_orm_1.eq)(schema_1.settingsVersions.countryCode, countryCode))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.settingsVersions.version))
            .limit(1);
        if (!row)
            throw (0, errors_1.notFound)('settings_missing', `No settings saved for ${countryCode}`);
        return { version: row.version, settings: shared_1.CountrySettingsSchema.parse(row.data) };
    }
    /** The settings an errand was created under, so its timers and limits never change mid-errand. */
    async settingsAt(countryCode, version) {
        const [row] = await this.db
            .select()
            .from(schema_1.settingsVersions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.settingsVersions.countryCode, countryCode), (0, drizzle_orm_1.eq)(schema_1.settingsVersions.version, version)));
        if (!row)
            throw (0, errors_1.notFound)('settings_missing', `No settings version ${version} for ${countryCode}`);
        return shared_1.CountrySettingsSchema.parse(row.data);
    }
    enabledStates(countryCode) {
        return this.db
            .select({ code: schema_1.states.code, name: schema_1.states.name, agentSignups: schema_1.states.agentSignups })
            .from(schema_1.states)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.states.countryCode, countryCode), (0, drizzle_orm_1.eq)(schema_1.states.enabled, true)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.states.name));
    }
    async enabledState(countryCode, code) {
        const [state] = await this.db
            .select()
            .from(schema_1.states)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.states.countryCode, countryCode), (0, drizzle_orm_1.eq)(schema_1.states.code, code), (0, drizzle_orm_1.eq)(schema_1.states.enabled, true)));
        return state;
    }
    activeCategories(countryCode) {
        return this.db
            .select({
            key: schema_1.categories.key,
            name: schema_1.categories.name,
            icon: schema_1.categories.icon,
            description: schema_1.categories.description,
            buyDefault: schema_1.categories.buyDefault,
        })
            .from(schema_1.categories)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.categories.countryCode, countryCode), (0, drizzle_orm_1.eq)(schema_1.categories.active, true), (0, drizzle_orm_1.isNull)(schema_1.categories.deletedAt)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.categories.sort), (0, drizzle_orm_1.asc)(schema_1.categories.name));
    }
    async activeCategory(countryCode, key) {
        const [category] = await this.db
            .select()
            .from(schema_1.categories)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.categories.countryCode, countryCode), (0, drizzle_orm_1.eq)(schema_1.categories.key, key), (0, drizzle_orm_1.eq)(schema_1.categories.active, true), (0, drizzle_orm_1.isNull)(schema_1.categories.deletedAt)));
        return category;
    }
};
exports.CountriesService = CountriesService;
exports.CountriesService = CountriesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __metadata("design:paramtypes", [Object])
], CountriesService);
//# sourceMappingURL=countries.service.js.map