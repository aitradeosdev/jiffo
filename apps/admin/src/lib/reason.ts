/** A reason is a few words at least, as the API asks (docs/security-plan.md, D7). */
export const REASON_MIN = 5;

/**
 * Whether a form's result is a change refused for want of a reason: it came back with an error while the page's
 * reason box holds less than a reason. The box is then pointed to, as it sits at the top of the page, out of sight
 * of a form further down.
 */
export const reasonMissing = (after: { error?: string } | undefined, reason: string) =>
  !!after?.error && reason.trim().length < REASON_MIN;
