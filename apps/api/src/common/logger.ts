import { ConsoleLogger } from '@nestjs/common';
import { redact, scrub } from './redact';

/** A log argument with personal details masked: text scrubbed, objects redacted, errors rebuilt from both. */
function clean(value: unknown): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value instanceof Error) {
    const copy = new Error(scrub(value.message));
    copy.name = value.name;
    copy.stack = value.stack === undefined ? undefined : scrub(value.stack);
    return copy;
  }
  return value && typeof value === 'object' ? redact(value) : value;
}

/**
 * The API's logger (docs/security-plan.md, S7): every line passes through redaction first, since provider
 * messages and errors can quote an account number, phone number or email. In production it writes one JSON
 * object per line, for the hosting's log store to index.
 */
export class RedactingLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]) {
    super.log(clean(message), ...rest.map(clean));
  }
  override error(message: unknown, ...rest: unknown[]) {
    super.error(clean(message), ...rest.map(clean));
  }
  override warn(message: unknown, ...rest: unknown[]) {
    super.warn(clean(message), ...rest.map(clean));
  }
  override debug(message: unknown, ...rest: unknown[]) {
    super.debug(clean(message), ...rest.map(clean));
  }
  override verbose(message: unknown, ...rest: unknown[]) {
    super.verbose(clean(message), ...rest.map(clean));
  }
  override fatal(message: unknown, ...rest: unknown[]) {
    super.fatal(clean(message), ...rest.map(clean));
  }
}
