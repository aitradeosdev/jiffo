import 'server-only';

/** The panel's server settings. Missing values in production stop it at the first request, not silently. */
function read() {
  const production = process.env.NODE_ENV === 'production';
  const apiUrl = process.env.API_URL ?? (production ? '' : 'http://localhost:3000');
  const panelSecret = process.env.ADMIN_PANEL_SECRET ?? '';
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? (production ? NaN : 0));
  const problems = [
    !apiUrl && 'API_URL',
    production && panelSecret.length < 32 && 'ADMIN_PANEL_SECRET (at least 32 characters)',
    (!Number.isInteger(hops) || hops < 0) && 'TRUST_PROXY_HOPS',
  ].filter(Boolean);
  if (problems.length) throw new Error(`Admin panel settings missing or wrong: ${problems.join(', ')}`);
  return { apiUrl: apiUrl.replace(/\/$/, ''), panelSecret, trustProxyHops: hops, production };
}

let cached: ReturnType<typeof read> | null = null;
export const env = () => (cached ??= read());
