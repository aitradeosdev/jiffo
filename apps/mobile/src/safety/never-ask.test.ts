import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEVER_ASK } from './never-ask';

/** Where each notice is shown: a screen that stops showing one fails here. */
const SHOWN: Record<keyof typeof NEVER_ASK, string[]> = {
  code: ['app/(auth)/code.tsx'],
  appPin: ['app/(app)/pin.tsx', 'src/auth/use-money-action.tsx'],
  handoffPin: ['src/errands/trip.tsx'],
  agentHandoff: ['app/(app)/errand/[id]/handoff.tsx'],
};
const root = join(__dirname, '..', '..');

describe('the apps say Jiffo never asks for a code or PIN (C7)', () => {
  it('says so for the sign-in code, the app PIN and the hand-off PIN', () => {
    for (const text of Object.values(NEVER_ASK)) expect(text).toMatch(/^Jiffo will never ask for/);
  });

  it('shows each notice on the screens where the code or PIN is entered or shown', () => {
    for (const [key, files] of Object.entries(SHOWN)) {
      for (const file of files) {
        expect(readFileSync(join(root, file), 'utf8'), `${file} shows NEVER_ASK.${key}`).toContain(
          `{NEVER_ASK.${key}}`,
        );
      }
    }
  });

  it('tells the customer to say the hand-off PIN in person, never through the app, not even to the agent', () => {
    expect(NEVER_ASK.handoffPin).toMatch(/in person/);
    expect(NEVER_ASK.handoffPin).toMatch(/never by call, text or chat, not even to them/);
  });
});
