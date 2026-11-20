/**
 * What the apps say wherever a sign-in code or PIN is shown or entered (docs/security-plan.md, C7): Jiffo never
 * asks for either, so anyone who does, even saying they're from Jiffo, is trying to take the account or money.
 */
export const NEVER_ASK = {
  code: 'Jiffo will never ask for this code. Never give it to anyone, even someone who says they’re from Jiffo.',
  appPin:
    'Jiffo will never ask for your PIN or a sign-in code. Never share them, even with someone who says they’re from Jiffo.',
  /** The hand-off PIN is given to the agent, in person, and to nobody else. */
  handoffPin: 'Jiffo will never ask for this PIN, by call, text or chat.',
} as const;
