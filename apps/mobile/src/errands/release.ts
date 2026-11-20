import { releaseIn } from '@jiffo/shared';

/** While a drop-off photo waits: when it is approved by itself, and since when support has that paused. */
export interface Release {
  dueAt: string;
  pausedAt: string | null;
}

/**
 * What happens if the customer doesn't answer a drop-off photo, as a sentence (docs/security-plan.md, X1, X2):
 * when it approves itself, or that support has paused that. 24 hours for a version of the API that doesn't say.
 */
export function approvalLine(release: Release | null | undefined, now = Date.now()) {
  if (release?.pausedAt) return 'Jiffo support paused the automatic approval while they check it';
  return `It approves itself in ${release ? releaseIn(release.dueAt, now) : '24 hours'}`;
}
