import type { AdminRole } from '../db/schema';

/**
 * What admins can do, by role. Every admin route names the permission it needs, and the panel uses the
 * same list to decide what to show.
 */
export const PERMISSIONS = [
  /** The overview, errands, people and the money pages: looking only. */
  'read',
  /** Resolving disputes, stepping into errands, suspending people and setting agent tiers. */
  'operate',
  /** Wallet adjustments and manual refunds. */
  'money',
  /** Categories, prices, fees, timers and states. */
  'settings',
  /** Inviting admins, changing their roles and reading the audit log. */
  'team',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BY_ROLE: Record<AdminRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  operations: ['read', 'operate'],
  finance: ['read', 'money'],
  support: ['read'],
};

export const permissionsFor = (role: AdminRole): readonly Permission[] => BY_ROLE[role];
export const can = (role: AdminRole, permission: Permission) => BY_ROLE[role].includes(permission);
