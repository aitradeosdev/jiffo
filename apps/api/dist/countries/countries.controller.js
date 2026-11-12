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
exports.CountriesController = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@jiffo/shared");
const countries_service_1 = require("./countries.service");
let CountriesController = class CountriesController {
    countries;
    constructor(countries) {
        this.countries = countries;
    }
    /** Everything the apps need at start-up for one country. Public: the apps call it before sign-in. */
    async config(code) {
        const country = await this.countries.enabledCountry(code);
        const [{ version, settings }, states, categories] = await Promise.all([
            this.countries.currentSettings(country.code),
            this.countries.enabledStates(country.code),
            this.countries.activeCategories(country.code),
        ]);
        return {
            country: {
                code: country.code,
                name: country.name,
                currency: country.currency,
                phonePrefix: country.phonePrefix,
                timezone: country.timezone,
            },
            settingsVersion: version,
            settings: (0, shared_1.publicSettings)(settings),
            states,
            categories,
        };
    }
};
exports.CountriesController = CountriesController;
__decorate([
    (0, common_1.Get)(':country'),
    __param(0, (0, common_1.Param)('country')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CountriesController.prototype, "config", null);
exports.CountriesController = CountriesController = __decorate([
    (0, common_1.Controller)('config'),
    __metadata("design:paramtypes", [countries_service_1.CountriesService])
], CountriesController);
//# sourceMappingURL=countries.controller.js.map