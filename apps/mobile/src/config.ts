import Constants from 'expo-constants';

export type Variant = 'customer' | 'agent';

const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: Variant; apiUrl?: string; country?: string };

/** Which store app this build is. Every app-specific screen and API call keys off this. */
export const VARIANT: Variant = extra.variant === 'agent' ? 'agent' : 'customer';
export const API_URL = (extra.apiUrl ?? 'http://localhost:3000').replace(/\/$/, '');
export const COUNTRY = extra.country ?? 'NG';
