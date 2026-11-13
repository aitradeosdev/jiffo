import { ADMIN_ROLE_INFO, ADMIN_ROLES } from '@jiffo/shared';

/** The admin roles in the order the team page offers them. Names and permissions come from @jiffo/shared. */
export const ROLES = ADMIN_ROLES.map((value) => ({ value, ...ADMIN_ROLE_INFO[value] }));
