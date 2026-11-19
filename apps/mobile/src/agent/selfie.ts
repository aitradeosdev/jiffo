/**
 * Agents' selfie checks (docs/security-plan.md, A4, I2, I8, P8, X4): what the app asks the server and how it
 * waits for the verdict. Plain TypeScript, so it runs in tests without React Native.
 */
import { ApiError } from '../api/client';

export type SelfieReason = 'daily' | 'random' | 'new_device' | 'payout_change';

/** What the provider's SDK needs, from the server: for Smile ID, a token for this check alone. */
export interface SelfieSession {
  enrolledId: string;
  reference: string;
  token?: string;
  partnerId?: string;
  sandbox?: boolean;
  /** Shown before the selfie is taken, as the notice the agent agrees to. */
  privacyPolicyUrl?: string;
}

export interface StartedSelfie {
  id: string;
  provider: string;
  reason: SelfieReason;
  session: SelfieSession;
}

export type SelfieAnswer =
  | { status: 'pending' }
  | { status: 'passed' }
  | { status: 'unclear'; note?: string }
  | { status: 'failed'; triesLeft?: number; note?: string | null }
  | { status: 'suspended' };

const REASONS: readonly SelfieReason[] = ['daily', 'random', 'new_device', 'payout_change'];

/** The selfie an action asked for, if it was refused for want of one. */
export function selfieNeeded(error: unknown): SelfieReason | null {
  if (!(error instanceof ApiError) || error.code !== 'selfie_needed') return null;
  const reason = error.details.reason;
  return REASONS.includes(reason as SelfieReason) ? (reason as SelfieReason) : 'daily';
}

/** Why the selfie is asked for, in the agent's words. */
export const SELFIE_WHY: Record<SelfieReason, string> = {
  daily: "Your first time online today. We check it's you, so nobody else can work as you.",
  random: "A quick extra check that it's you, before you go online.",
  new_device: "You're on a new phone. We check it's you before money can move from it.",
  payout_change: "You're changing where your money goes. We check it's you first.",
};

/**
 * Asks for the verdict until there is one: the provider may take a moment after the selfie is sent. Gives
 * up after `timeoutMs`, answering pending, so the screen can say to try again.
 */
export async function waitForVerdict(
  finish: () => Promise<SelfieAnswer>,
  {
    every = 2_000,
    timeoutMs = 90_000,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  }: { every?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<SelfieAnswer> {
  const until = now() + timeoutMs;
  for (;;) {
    const answer = await finish();
    if (answer.status !== 'pending' || now() >= until) return answer;
    await sleep(every);
  }
}

/**
 * Runs an action; if the server asks for a selfie first, takes it and runs the action once more. Null when
 * the agent didn't pass it (cancelled, unclear, failed): the selfie screen has said why.
 */
export async function withSelfie<T>(
  action: () => Promise<T>,
  take: (reason: SelfieReason) => Promise<boolean>,
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    const reason = selfieNeeded(error);
    if (!reason) throw error;
    if (!(await take(reason))) return null;
    return action();
  }
}
