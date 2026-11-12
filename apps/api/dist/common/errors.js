"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiExceptionFilter = exports.unavailable = exports.tooMany = exports.locked = exports.unprocessable = exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.ApiError = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@jiffo/shared");
/** Every API error has the same shape: { error: { code, message, ...details } }. */
class ApiError extends common_1.HttpException {
    constructor(status, code, message, details = {}) {
        super({ error: { code, message, ...details } }, status);
    }
}
exports.ApiError = ApiError;
const badRequest = (code, message, details) => new ApiError(common_1.HttpStatus.BAD_REQUEST, code, message, details);
exports.badRequest = badRequest;
const unauthorized = (code, message, details) => new ApiError(common_1.HttpStatus.UNAUTHORIZED, code, message, details);
exports.unauthorized = unauthorized;
const forbidden = (code, message) => new ApiError(common_1.HttpStatus.FORBIDDEN, code, message);
exports.forbidden = forbidden;
const notFound = (code, message) => new ApiError(common_1.HttpStatus.NOT_FOUND, code, message);
exports.notFound = notFound;
const conflict = (code, message, details) => new ApiError(common_1.HttpStatus.CONFLICT, code, message, details);
exports.conflict = conflict;
const unprocessable = (code, message, details) => new ApiError(common_1.HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
exports.unprocessable = unprocessable;
const locked = (code, message) => new ApiError(common_1.HttpStatus.LOCKED, code, message);
exports.locked = locked;
const tooMany = (code, message, details) => new ApiError(common_1.HttpStatus.TOO_MANY_REQUESTS, code, message, details);
exports.tooMany = tooMany;
const unavailable = (code, message) => new ApiError(common_1.HttpStatus.SERVICE_UNAVAILABLE, code, message);
exports.unavailable = unavailable;
const TRANSITION_STATUS = {
    unknown_event: common_1.HttpStatus.BAD_REQUEST,
    not_allowed: common_1.HttpStatus.FORBIDDEN,
    invalid_state: common_1.HttpStatus.CONFLICT,
    blocked: common_1.HttpStatus.CONFLICT,
};
const STATUS_CODES = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    429: 'too_many_requests',
};
/**
 * Gives every error the same shape. Errand rule violations from the shared state machine become
 * errand_<code>; framework errors (unknown route, bad JSON) get a generic code; anything unexpected
 * is logged and answered as internal_error without details.
 */
let ApiExceptionFilter = class ApiExceptionFilter {
    logger = new common_1.Logger('ApiExceptionFilter');
    catch(error, host) {
        if (host.getType() !== 'http')
            throw error;
        const res = host.switchToHttp().getResponse();
        if (error instanceof shared_1.TransitionError) {
            res
                .status(TRANSITION_STATUS[error.code])
                .json({ error: { code: `errand_${error.code}`, message: error.message } });
            return;
        }
        if (error instanceof common_1.HttpException) {
            const status = error.getStatus();
            const body = error.getResponse();
            if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object') {
                res.status(status).json(body);
                return;
            }
            const message = typeof body === 'string' ? body : (body.message ?? error.message);
            res.status(status).json({
                error: {
                    code: STATUS_CODES[status] ?? 'error',
                    message: Array.isArray(message) ? message.join('; ') : String(message),
                },
            });
            return;
        }
        this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
        res
            .status(common_1.HttpStatus.INTERNAL_SERVER_ERROR)
            .json({ error: { code: 'internal_error', message: 'Something went wrong' } });
    }
};
exports.ApiExceptionFilter = ApiExceptionFilter;
exports.ApiExceptionFilter = ApiExceptionFilter = __decorate([
    (0, common_1.Catch)()
], ApiExceptionFilter);
//# sourceMappingURL=errors.js.map