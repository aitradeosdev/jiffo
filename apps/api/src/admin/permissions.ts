import { ADMIN_ROLE_INFO, adminErrandPermission, type AdminPermission, type AdminRole } from '@jiffo/shared';
import { ADMIN_ERRAND_EVENTS, type AdminErrandEvent } from '../errands/errands.service';

export type Permission = AdminPermission;

export const permissionsFor = (role: AdminRole): readonly Permission[] => ADMIN_ROLE_INFO[role].permissions;
export const can = (role: AdminRole, permission: Permission) => ADMIN_ROLE_INFO[role].permissions.includes(permission);

/** Stepping into an errand needs errands; settling its dispute needs disputes (docs/security-plan.md, D3). */
export const ERRAND_EVENT_PERMISSION = Object.fromEntries(
  ADMIN_ERRAND_EVENTS.map((e) => [e, adminErrandPermission(e)]),
) as Record<AdminErrandEvent, Permission>;
