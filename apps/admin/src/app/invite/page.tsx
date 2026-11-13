import type { Metadata } from 'next';
import { AuthFrame } from '@/components/auth-frame';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Join the team' };

export default function InvitePage() {
  return (
    <AuthFrame>
      <InviteForm />
    </AuthFrame>
  );
}
