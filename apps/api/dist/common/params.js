"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrandId = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("./errors");
/** An id that is not a UUID cannot be an errand: answer as not found, the same as any other unknown id. */
exports.ErrandId = new common_1.ParseUUIDPipe({ exceptionFactory: () => (0, errors_1.notFound)('errand_not_found', 'Errand not found') });
//# sourceMappingURL=params.js.map