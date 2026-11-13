import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Masked calls between a customer and their agent. The provider rings the caller's phone and, when they
 * answer, connects them to the other person; each sees only the provider's number. Calls aren't recorded.
 * A call-back on the phone network, rather than a call over data, works on any phone and a weak connection.
 */
export interface CallsAdapter {
  readonly name: string;
  /** Rings `from`, then connects them to `to`. Both are E.164 numbers. */
  bridge(input: { reference: string; from: string; to: string }): Promise<{ providerRef: string }>;
}

export const CALLS = Symbol('CALLS');

/** For development and tests: no phone rings. The calls are kept so tests can see them. */
export class FakeCallsAdapter implements CallsAdapter {
  readonly name = 'fake';
  private readonly logger = new Logger('FakeCalls');
  readonly calls: Array<{ reference: string; from: string; to: string }> = [];

  async bridge(input: { reference: string; from: string; to: string }) {
    this.calls.push(input);
    this.logger.log(`Call ${input.reference}: ringing ${input.from}, then ${input.to}`);
    return { providerRef: `fake_call_${randomUUID()}` };
  }
}

/** Until a provider is set up: every call is refused with a message the apps can show. */
export class UnconfiguredCallsAdapter implements CallsAdapter {
  readonly name = 'none';
  bridge(): Promise<never> {
    return Promise.reject(new CallsUnavailable());
  }
}

export class CallsUnavailable extends Error {
  constructor() {
    super('No calls provider is set up');
  }
}
