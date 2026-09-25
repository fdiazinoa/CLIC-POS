import type { RoleDefinition, User } from '../types';

const TEMPORARY_ERP_EXIT_ROLES = new Set(['ADMIN', 'ADMINISTRADOR', 'ADMINISTRATOR', 'SUPERVISOR']);

const normalizeRoleName = (name: string): string =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

/** The effective role permissions are authoritative, including explicit revocation. */
export const canExitTableMapToDirectSale = (
  user: User | null | undefined,
  roles: readonly RoleDefinition[],
): boolean => {
  if (!user) return false;
  const roleId = String(user.roleId || user.role || '').trim();
  const role = roles.find(candidate => candidate.id === roleId);
  if (!role || user.isActive === false || role.isActive === false) return false;
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  if (permissions.includes('ALL') || permissions.includes('POS_EXIT_TABLE_MAP')) return true;
  // Temporary compatibility until ERP role snapshots include POS_EXIT_TABLE_MAP.
  // Local roles remain permission-authoritative, including explicit revocation.
  return role.syncSource === 'ERP_SNAPSHOT' && TEMPORARY_ERP_EXIT_ROLES.has(normalizeRoleName(role.name));
};
