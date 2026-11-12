import { ParseUUIDPipe } from '@nestjs/common';
/** An id that is not a UUID cannot be an errand: answer as not found, the same as any other unknown id. */
export declare const ErrandId: ParseUUIDPipe;
