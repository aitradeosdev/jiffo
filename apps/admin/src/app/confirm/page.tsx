import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth-frame';
import { api } from '@/lib/api';
import { samePath } from '@/lib/same-path';
import { ConfirmCode, ConfirmPasskey } from './forms';

export const metadata: Metadata = { title: "Confirm it's you" };

/**
 * Before a money action: the admin proves it's them again, with their passkey or a fresh code
 * (docs/security-plan.md, D6). Then back to the page they were on, to do it again.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ back?: string }> }) {
  const back = samePath((await searchParams).back ?? '/');
  const { method } = await api<{ method: 'passkey' | 'code' }>('/admin/auth/confirm/start', { method: 'POST' });
  return (
    <AuthFrame>
      <h1 className="text-2xl font-extrabold tracking-tight">Confirm it&apos;s you</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">
        Money actions need you to confirm every few minutes. Then go back and do it again.
      </p>
      {method === 'passkey' ? <ConfirmPasskey back={back} /> : <ConfirmCode back={back} />}
      <p className="mt-6 text-center text-sm">
        <Link href={back} className="font-semibold text-ink-3 underline">
          Go back without confirming
        </Link>
      </p>
    </AuthFrame>
  );
}
