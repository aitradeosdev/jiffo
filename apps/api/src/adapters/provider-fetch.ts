/** How long any call to a provider may take before it is given up on. */
export const PROVIDER_FETCH_TIMEOUT_MS = 20_000;

/**
 * fetch for calls to providers (docs/security-plan.md, S9): a timeout on every call, and redirects refused
 * rather than followed, so a provider address that sends elsewhere can't take keys or data with it. A caller
 * that sets its own signal or redirect keeps it.
 */
export const providerFetch: typeof fetch = (input, init) =>
  fetch(input, {
    redirect: 'error',
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
  });
