/**
 * Admin roles and what each may do. The API enforces these on every admin route, and the panel uses the same
 * list to decide what to show. Each role has only what its work needs (docs/security-plan.md, D3).
 */
export const ADMIN_ROLES = ['owner', 'operations', 'disputes', 'verification', 'finance', 'safety', 'support'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  /** The overview, errands, people and the money pages: looking only. */
  'read',
  /** Stepping into an errand: cancelling, intervening, arranging redelivery. */
  'errands',
  /** Settling disputes, the standard way or by splitting the money held. */
  'disputes',
  /** Suspending and reactivating accounts. */
  'suspend',
  /** Setting agent tiers. */
  'tiers',
  /** Deciding agent applications and customers' ID checks. */
  'verify',
  /** Wallet adjustments and refunds, payout accounts, the nightly checks and money alerts. */
  'money',
  /** Prices, fees, timers, limits, categories, states and providers. */
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
  operations: {
    label: 'Operations',
    about: 'Errands, disputes, suspensions and agent tiers',
    permissions: ['read', 'errands', 'disputes', 'suspend', 'tiers'],
  },
  disputes: { label: 'Disputes', about: 'Settling disputes', permissions: ['read', 'disputes'] },
  verification: {
    label: 'Verification',
    about: "Agent applications and customers' ID checks",
    permissions: ['read', 'verify'],
  },
  finance: {
    label: 'Finance',
    about: 'Money: refunds, adjustments and payouts',
    permissions: ['read', 'money'],
  },
  safety: { label: 'Safety', about: 'Suspending accounts that put people at risk', permissions: ['read', 'suspend'] },
  support: { label: 'Support', about: 'Can look, but not change anything', permissions: ['read'] },
};

export const isAdminRole = (value: string): value is AdminRole => (ADMIN_ROLES as readonly string[]).includes(value);

/** A role's name for people, or the raw value for one this version doesn't know. */
export const adminRoleLabel = (role: string) => (isAdminRole(role) ? ADMIN_ROLE_INFO[role].label : role);

/**
 * Roles that move money, approve refunds or see ID data sign in with a passkey (docs/security-plan.md, D2,
 * X6); for the rest an authenticator app is the minimum.
 */
export const needsPasskey = (role: string): boolean =>
  isAdminRole(role) && ADMIN_ROLE_INFO[role].permissions.some((p) => p === 'money' || p === 'verify');

/** Settling a dispute (resolve_*) needs disputes; any other step into an errand needs errands. */
export const adminErrandPermission = (event: string): AdminPermission =>
  event.startsWith('resolve_') ? 'disputes' : 'errands';

/** The roles that hold a permission, for finding who may approve a change. */
export const rolesWith = (permission: AdminPermission): AdminRole[] =>
  ADMIN_ROLES.filter((r) => ADMIN_ROLE_INFO[r].permissions.includes(permission));

/**
 * Changes a second admin must approve (docs/security-plan.md, D4, X7). The person who asked can never
 * approve their own, except when nobody else holds the permission: then it goes ahead, marked as such.
 */
export const APPROVAL_KINDS = [
  'wallet_adjustment',
  'dispute_split',
  'settings_change',
  'team_invite',
  'team_change',
  'agent_suspend',
  'provider_change',
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_INFO: Record<ApprovalKind, { label: string; permission: AdminPermission }> = {
  wallet_adjustment: { label: 'Wallet adjustment', permission: 'money' },
  dispute_split: { label: 'Dispute split', permission: 'disputes' },
  settings_change: { label: 'Settings change', permission: 'settings' },
  team_invite: { label: 'New teammate', permission: 'team' },
  team_change: { label: 'Role change', permission: 'team' },
  agent_suspend: { label: 'Suspending a busy agent', permission: 'suspend' },
  provider_change: { label: 'Provider change', permission: 'settings' },
};

export const APPROVAL_STATUSES = [
  'pending',
  'running',
  'approved',
  'rejected',
  'cancelled',
  'failed',
  'expired',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
