/**
 * Admin roles and what each may do. The API enforces these on every admin route, and the panel uses the same
 * list to decide what to show.
 */
export const ADMIN_ROLES = ['owner', 'operations', 'finance', 'support'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
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
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_INFO: Record<
  AdminRole,
  { label: string; about: string; permissions: readonly AdminPermission[] }
> = {
  owner: { label: 'Owner', about: 'Everything, including the team and settings', permissions: ADMIN_PERMISSIONS },
  operations: { label: 'Operations', about: 'Errands, disputes and people', permissions: ['read', 'operate'] },
  finance: { label: 'Finance', about: 'Money: refunds, adjustments and payouts', permissions: ['read', 'money'] },
  support: { label: 'Support', about: 'Can look, but not change anything', permissions: ['read'] },
};

export const isAdminRole = (value: string): value is AdminRole => (ADMIN_ROLES as readonly string[]).includes(value);

/** A role's name for people, or the raw value for one this version doesn't know. */
export const adminRoleLabel = (role: string) => (isAdminRole(role) ? ADMIN_ROLE_INFO[role].label : role);
