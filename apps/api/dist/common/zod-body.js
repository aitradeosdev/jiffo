"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZodBody = void 0;
const errors_1 = require("./errors");
/** Validates and parses a request body (or query) with a zod schema: @Body(new ZodBody(Schema)). */
class ZodBody {
    schema;
    constructor(schema) {
        this.schema = schema;
    }
    transform(value) {
        const parsed = this.schema.safeParse(value);
        if (!parsed.success) {
            throw (0, errors_1.badRequest)('invalid_request', 'The request is not valid', {
                issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            });
        }
        return parsed.data;
    }
}
exports.ZodBody = ZodBody;
//# sourceMappingURL=zod-body.js.map