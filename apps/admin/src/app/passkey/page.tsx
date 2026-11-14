import type { Metadata } from 'next';
import { AuthFrame } from '@/components/auth-frame';
import { getMe } from '@/lib/api';
import { signOut } from '../(panel)/actions';
import { AddPasskey } from './add-passkey';

export const metadata: Metadata = { title: 'Add a passkey' };

/**
 * Adding a passkey. Roles that move money or see ID data must have one before anything else, and sign in
 * with it from then on (docs/security-plan.md, D2, X6); anyone may add one.
 */
export default async function PasskeyPage() {
  const me = await getMe();
  return (
    <AuthFrame>
      <h1 className="text-2xl font-extrabold tracking-tight">Add a passkey</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">
        {me.needsPasskey
          ? 'Your role handles money or ID checks, so you sign in with a passkey: your fingerprint, face or PIN on this device. Add one to continue.'
          : 'A passkey lets you sign in with your fingerprint, face or PIN on this device.'}
      </p>
      <AddPasskey />
      <form action={signOut} className="mt-6 text-center">
        <button type="submit" className="text-sm font-semibold text-ink-3 underline">
          Sign out
        </button>
      </form>
    </AuthFrame>
  );
}
