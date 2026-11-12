import { ParseUUIDPipe } from '@nestjs/common';
import { notFound } from './errors';

/** An id that is not a UUID cannot be an errand: answer as not found, the same as any other unknown id. */
export const ErrandId = new ParseUUIDPipe({ exceptionFactory: () => notFound('errand_not_found', 'Errand not found') });
