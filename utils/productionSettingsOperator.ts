import type { RoleDefinition, User } from '../types';

export function productionSettingsOperators(users: User[], roles: RoleDefinition[]): User[] {
  return users.filter(user => user.isActive !== false && roles.some(role =>
    role.id === (user.roleId || user.role)
    && role.permissions.some(permission => permission === 'ALL' || permission === 'SETTINGS_ACCESS')));
}
