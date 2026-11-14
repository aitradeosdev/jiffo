import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PasskeyButton } from '@/components/passkey-button';
import { CHALLENGE_COOKIE } from '@/lib/cookies';
import { finishSignIn, signInOptions } from '../passkey-actions';

export const metadata: Metadata = { title: 'Use your passkey' };

/** Step two for roles that move money or see ID data: their passkey, not a code (docs/security-plan.md, D2). */
export default async function PasskeySignInPage() {
  if (!(await cookies()).get(CHALLENGE_COOKIE)) redirect('/sign-in');
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Use your passkey</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">
        Confirm with the fingerprint, face or PIN on the device where you added your passkey.
      </p>
      <PasskeyButton label="Sign in with passkey" options={signInOptions} finish={finishSignIn} />
      <p className="mt-6 text-center text-sm text-ink-3">
        Lost your device? Ask an owner to reset your access.{' '}
        <Link href="/sign-in" className="font-semibold text-ink underline">
          Start again
        </Link>
      </p>
    </>
  );
}
