import type { ReactNode } from 'react';
import { AuthFrame } from '@/components/auth-frame';

export default function SignInLayout({ children }: { children: ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
