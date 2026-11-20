import { describe, expect, it } from 'vitest';
import { NEVER_ASK } from './never-ask';

describe('the apps say Jiffo never asks for a code or PIN (C7)', () => {
  it('says so for the sign-in code, the app PIN and the hand-off PIN', () => {
    for (const text of Object.values(NEVER_ASK)) expect(text).toMatch(/^Jiffo will never ask for/);
  });
});
