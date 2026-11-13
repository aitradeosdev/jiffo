/** Shared by Africa's Talking SMS and Voice: one account, the same hosts and the same account check. */

/** Their username "sandbox" means their sandbox. */
const sandbox = (username: string) => username.toLowerCase() === 'sandbox';

export const africasTalkingApi = (username: string) =>
  sandbox(username) ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';

export const africasTalkingVoice = (username: string) =>
  sandbox(username) ? 'https://voice.sandbox.africastalking.com' : 'https://voice.africastalking.com';

/** For the panel's Test button: the account and its balance. Sends and rings nothing. */
export async function africasTalkingCheck(username: string, apiKey: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${africasTalkingApi(username)}/version1/user?username=${encodeURIComponent(username)}`, {
    headers: { apikey: apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { UserData?: { balance?: string } } | null;
  if (!res.ok) throw new Error(`Africa's Talking answered ${res.status}`);
  return `Connected. Balance: ${body?.UserData?.balance ?? 'not shown'}`;
}

/** How long a request to a provider may take before it counts as failed. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** A phone number as it may appear in a provider's XML: + and digits only. */
export const e164Digits = (phone: string) => phone.replace(/[^+\d]/g, '');
