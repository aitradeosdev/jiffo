import type { Request } from 'express';

/** Who the request is really from: the admin's own IP and browser, as the panel passes them on. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/** The signed-in admin. Set on the request by AdminGuard. */
export interface AdminContext {
  adminId: string;
  sessionId: string;
  email: string;
  name: string;
  role: string;
  ip: string | null;
  /** When they last proved it was them, at sign-in or since. */
  confirmedAt: Date;
  /** Their role signs in with a passkey and they have none yet. */
  passkeyMissing: boolean;
  /**
   * Set when this runs a change a second admin approved: the audit log then shows both people
   * (docs/security-plan.md, D4, D7).
   */
  approval?: { id: string; approvedBy: string; selfApproved: boolean };
}

export type AdminRequest = Request & { admin?: AdminContext };
