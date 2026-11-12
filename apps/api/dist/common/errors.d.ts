import { ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
/** Every API error has the same shape: { error: { code, message, ...details } }. */
export declare class ApiError extends HttpException {
    constructor(status: number, code: string, message: string, details?: Record<string, unknown>);
}
export declare const badRequest: (code: string, message: string, details?: Record<string, unknown>) => ApiError;
export declare const unauthorized: (code: string, message: string, details?: Record<string, unknown>) => ApiError;
export declare const forbidden: (code: string, message: string) => ApiError;
export declare const notFound: (code: string, message: string) => ApiError;
export declare const conflict: (code: string, message: string, details?: Record<string, unknown>) => ApiError;
export declare const unprocessable: (code: string, message: string, details?: Record<string, unknown>) => ApiError;
export declare const locked: (code: string, message: string) => ApiError;
export declare const tooMany: (code: string, message: string, details?: Record<string, unknown>) => ApiError;
export declare const unavailable: (code: string, message: string) => ApiError;
/**
 * Gives every error the same shape. Errand rule violations from the shared state machine become
 * errand_<code>; framework errors (unknown route, bad JSON) get a generic code; anything unexpected
 * is logged and answered as internal_error without details.
 */
export declare class ApiExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(error: unknown, host: ArgumentsHost): void;
}
