import type { PublicSettings } from '@jiffo/shared';

export interface User {
  id: string;
  phone: string;
  countryCode: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: string;
}

export interface CountryConfig {
  country: { code: string; name: string; currency: string; phonePrefix: string; timezone: string };
  settingsVersion: number;
  settings: PublicSettings;
  states: Array<{ code: string; name: string; agentSignups: 'open' | 'waitlist' }>;
  categories: Array<{ key: string; name: string; icon: string; description: string; buyDefault: boolean }>;
  /** What the server has set up; missing on an older server. */
  features?: { calls: boolean };
}

export interface CodeSent {
  phone: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Only where sign-in codes are in Test (Settings, Security): no text was sent, and the app shows this. */
  testCode?: string;
}

export interface SignedIn {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: User;
  isNewUser: boolean;
}
