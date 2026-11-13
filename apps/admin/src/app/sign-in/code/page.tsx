import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CHALLENGE_COOKIE } from '@/lib/cookies';
import { CodeForm } from '../forms';

export const metadata: Metadata = { title: 'Enter your code' };

export default async function CodePage() {
  if (!(await cookies()).get(CHALLENGE_COOKIE)) redirect('/sign-in');
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Enter your code</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">
        Open your authenticator app and type the code shown for Jiffo Admin.
      </p>
      <CodeForm />
      <p className="mt-6 text-center text-sm text-ink-3">
        Lost your phone? Ask an owner to reset your access.{' '}
        <Link href="/sign-in" className="font-semibold text-ink underline">
          Start again
        </Link>
      </p>
    </>
  );
}
