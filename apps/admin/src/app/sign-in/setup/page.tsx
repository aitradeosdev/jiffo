import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { api, ApiError } from '@/lib/api';
import { CHALLENGE_COOKIE } from '@/lib/cookies';
import { CodeForm } from '../forms';

export const metadata: Metadata = { title: 'Set up your authenticator app' };

/** The setup key in groups of four, easier to type by hand. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

export default async function SetupPage() {
  const challenge = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!challenge) redirect('/sign-in');
  let setup: { secret: string; otpauthUrl: string };
  try {
    setup = await api('/admin/auth/setup', { method: 'POST', anonymous: true, body: { challenge } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/sign-in?ended=challenge');
    throw error;
  }
  // Drawn here on the server from the secret, so it never goes to a third-party QR service.
  const qr = await QRCode.toString(setup.otpauthUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Set up your authenticator app</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">
        You need it every time you sign in. Google Authenticator, Microsoft Authenticator or 1Password all work.
      </p>
      <ol className="mb-6 space-y-5 text-[15px]">
        <li>
          <span className="font-semibold">1. Scan this code with the app</span>
          {/* An image of the server-made code, rather than its markup in the page. */}
          <img
            className="mt-3 h-auto w-44 rounded-xl bg-white p-3"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`}
            alt="QR code for your authenticator app"
          />
        </li>
        <li>
          <span className="font-semibold">Can&apos;t scan? Type this key instead</span>
          <code className="num mt-2 block rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm font-semibold tracking-wider break-all select-all">
            {grouped(setup.secret)}
          </code>
        </li>
        <li className="font-semibold">2. Enter the code the app shows</li>
      </ol>
      <CodeForm label="Turn on and sign in" />
    </>
  );
}
