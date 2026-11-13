import type { Metadata } from 'next';
import { Notice } from '@/components/ui';
import { SignInForm } from './forms';

export const metadata: Metadata = { title: 'Sign in' };

const ENDED: Record<string, { tone: 'brand' | 'warn'; text: string }> = {
  idle: { tone: 'warn', text: 'You were signed out after 30 minutes without activity.' },
  '1': { tone: 'warn', text: 'Your session ended. Sign in again.' },
  challenge: { tone: 'warn', text: 'That took too long. Sign in again.' },
  out: { tone: 'brand', text: 'You signed out.' },
  welcome: { tone: 'brand', text: 'Your password is set. Sign in to set up your authenticator app.' },
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const notice = ENDED[(await searchParams).ended ?? ''];
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">For Jiffo staff. Every sign-in needs your authenticator app.</p>
      {notice ? (
        <div className="mb-4">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}
      <SignInForm />
    </>
  );
}
