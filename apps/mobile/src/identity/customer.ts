import { useCallback, useEffect, useState } from 'react';
import type { IdType } from '@jiffo/shared';
import { useSession } from '../auth/session';
import type { IdentityOptions } from './check';

/** The customer's identity check, as GET /v1/me/identity gives it. */
export interface CustomerIdentity extends IdentityOptions {
  status: 'none' | 'checking' | 'verified' | 'review' | 'failed' | 'declined';
  idType: IdType | null;
  legalName: string | null;
  checks: Array<{ key: string; outcome: 'passed' | 'failed' | 'review'; note?: string; label: string }>;
  decisionNote: string | null;
  reviewHours: number;
}

/** The customer's check, loaded on opening, with a way to load it again. */
export function useCustomerIdentity() {
  const { api } = useSession();
  const [identity, setIdentity] = useState<CustomerIdentity | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    try {
      const next = await api.get<CustomerIdentity>('/v1/me/identity');
      setIdentity(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { identity, error, reload };
}
