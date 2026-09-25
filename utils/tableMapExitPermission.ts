import type { RoleDefinition, User } from '../types';

/** The effective role permissions are authoritative, including explicit revocation. */
export const canExitTableMapToDirectSale = (
  user: User | null | undefined,
  roles: readonly RoleDefinition[],
): boolean => {
  if (!user) return false;
  const roleId = String(user.roleId || user.role || '').trim();
  const role = roles.find(candidate => candidate.id === roleId);
  if (!role) return false;
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  return permissions.includes('ALL') || permissions.includes('POS_EXIT_TABLE_MAP');
};
