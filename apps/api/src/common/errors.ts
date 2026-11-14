import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { TransitionError } from '@jiffo/shared';
import { ProviderNotConfigured } from '../providers/not-configured';
import type { Response } from 'express';

/** Every API error has the same shape: { error: { code, message, ...details } }. */
export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, ...details } }, status);
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
export const unauthorized = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNAUTHORIZED, code, message, details);
export const forbidden = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, code, message);
export const notFound = (code: string, message: string) => new ApiError(HttpStatus.NOT_FOUND, code, message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.CONFLICT, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
export const locked = (code: string, message: string) => new ApiError(HttpStatus.LOCKED, code, message);
export const gone = (code: string, message: string) => new ApiError(HttpStatus.GONE, code, message);
export const tooMany = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.TOO_MANY_REQUESTS, code, message, details);
export const unavailable = (code: string, message: string) =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, code, message);

const TRANSITION_STATUS: Record<TransitionError['code'], number> = {
  unknown_event: HttpStatus.BAD_REQUEST,
  not_allowed: HttpStatus.FORBIDDEN,
  invalid_state: HttpStatus.CONFLICT,
  blocked: HttpStatus.CONFLICT,
};

const STATUS_CODES: Record<number, string> = {
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
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(error: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw error;
    const res = host.switchToHttp().getResponse<Response>();

    if (error instanceof TransitionError) {
      res
        .status(TRANSITION_STATUS[error.code])
        .json({ error: { code: `errand_${error.code}`, message: error.message } });
      return;
    }
    if (error instanceof ProviderNotConfigured) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: { code: 'provider_not_configured', message: "This isn't available yet. Please try again later." },
      });
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object') {
        res.status(status).json(body);
        return;
      }
      const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? error.message);
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
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  }
}
