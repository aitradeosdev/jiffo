import { ADMIN_ROLE_INFO, type AdminPermission, type AdminRole } from '@jiffo/shared';

export type Permission = AdminPermission;

export const permissionsFor = (role: AdminRole): readonly Permission[] => ADMIN_ROLE_INFO[role].permissions;
export const can = (role: AdminRole, permission: Permission) => ADMIN_ROLE_INFO[role].permissions.includes(permission);
