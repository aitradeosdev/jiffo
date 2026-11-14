/** How long any call to a provider may take before it is given up on. */
export const PROVIDER_FETCH_TIMEOUT_MS = 20_000;

/**
 * fetch for calls to providers (docs/security-plan.md, S9): a timeout on every call, and redirects refused
 * rather than followed, so a provider address that sends elsewhere can't take keys or data with it. A refused
 * redirect is an error saying where it pointed, so a provider that moved is easy to tell apart from one that
 * is down. A caller that sets its own signal keeps it.
 */
export const providerFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, {
    ...init,
    redirect: 'manual',
    signal: init?.signal ?? AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
  });
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? 'somewhere else';
    throw new Error(`The provider answered with a redirect to ${to}, which isn't followed. Check its address.`);
  }
  return res;
};
