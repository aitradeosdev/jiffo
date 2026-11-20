import type { PhoneSelfieReason, SelfieReason } from '../db/schema';

/** What the agent app tells the agent each selfie is for. */
export const SELFIE_WHY: Record<SelfieReason, string> = {
  daily: 'Take a quick selfie to go online today',
  random: 'Take a quick selfie to go online',
  new_device: 'Take a quick selfie to use money on this phone',
  payout_change: 'Take a quick selfie to change your payout account',
  device_check: "Take a quick selfie: we couldn't fully check this phone",
};

/**
 * Why this phone needs a selfie before money actions on it, if it does: a new phone or a replaced key (A4,
 * X4), or a sign-in a check doubted (MB3, A10). A phone from before the reason was kept was a new phone.
 */
export function phoneSelfieReason(device: {
  selfieNeeded: boolean;
  selfieFor: PhoneSelfieReason | null;
}): PhoneSelfieReason | null {
  if (!device.selfieNeeded) return null;
  return device.selfieFor ?? 'new_device';
}
