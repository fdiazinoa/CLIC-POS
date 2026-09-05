import type { Permission, RoleDefinition, User } from '../types';

type SnapshotRow = Record<string, unknown>;

export class ErpSecuritySnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpSecuritySnapshotError';
  }
}

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const bool = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'si', 'sí', 'y'].includes(normalized)) return true;
  if (['false', 'no', 'n'].includes(normalized)) return false;
  return null;
};

const version = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const roleIdFromUser = (row: SnapshotRow): string => {
  const role = row.role && typeof row.role === 'object' && !Array.isArray(row.role)
    ? row.role as SnapshotRow
    : {};
  return text(
    row.pos_role_id ?? row.posRoleId ?? row.pos_role_code ?? row.posRoleCode
    ?? row.role_id ?? row.roleId ?? row.role_code ?? row.roleCode
    ?? role.id ?? role.code ?? row.role,
  );
};

const userId = (row: SnapshotRow): string => text(
  row.source_pos_user_id ?? row.sourcePosUserId ?? row.source_user_id ?? row.sourceUserId
  ?? row.id ?? row.user_id ?? row.userId ?? row.employee_id ?? row.employeeId
  ?? row.code ?? row.email ?? row.username,
);

const isRemoval = (row: SnapshotRow): boolean => {
  const operation = text(row._op ?? row.operation ?? row.action).toUpperCase();
  const canOperate = bool(
    row.puede_operar_pos ?? row.can_operate_pos ?? row.canOperatePos
    ?? row.allow_pos_access ?? row.allowPosAccess ?? row.pos_enabled ?? row.posEnabled,
  );
  return operation === 'DELETE' || operation === 'REMOVE' || canOperate === false
    || Boolean(text(row.deleted_at ?? row.deletedAt));
};

export const normalizeErpPermissions = (value: unknown): Permission[] | null => {
  if (!Array.isArray(value) && typeof value !== 'string') return null;
  const values = Array.isArray(value) ? value : value.split(/[\s,|]+/);
  const permissions = Array.from(new Set(
    values.map((permission) => text(permission).toUpperCase()).filter(Boolean),
  )) as Permission[];
  return typeof value === 'string' && permissions.length === 0 ? null : permissions;
};

export const normalizeErpRole = (raw: unknown): RoleDefinition | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as SnapshotRow;
  const id = text(
    row.id ?? row.pos_role_id ?? row.posRoleId ?? row.pos_role_code ?? row.posRoleCode
    ?? row.role_id ?? row.roleId ?? row.code,
  );
  const permissions = normalizeErpPermissions(
    row.permissions ?? row.permission_keys ?? row.permissionKeys ?? row.pos_permissions ?? row.posPermissions,
  );
  if (!id || permissions === null) return null;

  const maxDiscountPercent = Number(row.maxDiscountPercent ?? row.max_discount_percent);
  const roleVersion = version(row.version);
  return {
    id,
    name: text(row.name ?? row.nombre ?? row.label ?? row.description) || id,
    permissions,
    isSystem: bool(row.isSystem ?? row.is_system) ?? false,
    isActive: bool(row.isActive ?? row.is_active ?? row.active) ?? true,
    ...(Number.isFinite(maxDiscountPercent) ? { maxDiscountPercent } : {}),
    ...(roleVersion !== undefined ? { version: roleVersion } : {}),
    syncSource: 'ERP_SNAPSHOT',
  };
};

const normalizePin = (value: unknown): string => {
  const digits = text(value).replace(/\D/g, '');
  return /^\d{4}$/.test(digits) ? digits : '';
};

export interface AuthoritativeErpSecurityInput {
  roleRows: unknown[] | null;
  userRows: unknown[] | null;
  existingRoles: RoleDefinition[];
  existingUsers: User[];
}

export interface AuthoritativeErpSecuritySnapshot {
  roles: RoleDefinition[];
  users: User[];
  rolesChanged: boolean;
  usersChanged: boolean;
}

/** Build and validate both catalogs without mutating storage. */
export const buildAuthoritativeErpSecuritySnapshot = ({
  roleRows,
  userRows,
  existingRoles,
  existingUsers,
}: AuthoritativeErpSecurityInput): AuthoritativeErpSecuritySnapshot => {
  const currentRoles = Array.isArray(existingRoles)
    ? existingRoles.filter((role) => role?.syncSource === 'ERP_SNAPSHOT')
    : [];
  const currentUsers = Array.isArray(existingUsers)
    ? existingUsers.filter((user) => user?.syncSource === 'ERP_SNAPSHOT')
    : [];

  const roles = roleRows === null ? currentRoles : roleRows.map((raw, index) => {
    const normalized = normalizeErpRole(raw);
    if (!normalized) {
      throw new ErpSecuritySnapshotError(`Rol ERP inválido en la posición ${index}; permissions es obligatorio.`);
    }
    return normalized;
  });
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  if (rolesById.size !== roles.length) {
    throw new ErpSecuritySnapshotError('El snapshot ERP contiene IDs de rol duplicados.');
  }

  const existingUsersById = new Map(currentUsers.map((user) => [user.id, user]));
  const users = userRows === null ? currentUsers : userRows.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ErpSecuritySnapshotError(`Usuario ERP inválido en la posición ${index}.`);
    }
    const row = raw as SnapshotRow;
    if (isRemoval(row)) return [];

    const id = userId(row);
    const name = text(row.name ?? row.nombre ?? row.full_name ?? row.fullName
      ?? row.display_name ?? row.displayName ?? row.username ?? row.email);
    const roleId = roleIdFromUser(row);
    const previous = existingUsersById.get(id);
    const isActive = bool(row.is_active ?? row.isActive ?? row.active) ?? true;
    const pin = normalizePin(row.pos_pin ?? row.posPin ?? row.pin ?? row.pin_code ?? row.pinCode)
      || previous?.pin || '';
    if (!id || !name || (isActive && (!roleId || !pin))) {
      throw new ErpSecuritySnapshotError(`Usuario ERP inválido en la posición ${index}; id, nombre, PIN y roleId son obligatorios.`);
    }
    const userVersion = version(row.version);
    const photo = text(row.photo ?? row.avatar ?? row.image ?? row.image_url ?? row.imageUrl
      ?? row.photo_url ?? row.photoUrl) || previous?.photo;
    return [{
      ...(previous || {}),
      id,
      name,
      pin,
      role: roleId,
      roleId,
      ...(photo ? { photo } : {}),
      isActive,
      ...(userVersion !== undefined ? { version: userVersion } : {}),
      syncSource: 'ERP_SNAPSHOT' as const,
    }];
  });

  const userIds = new Set<string>();
  users.forEach((user) => {
    if (userIds.has(user.id)) throw new ErpSecuritySnapshotError(`Usuario ERP duplicado: ${user.id}.`);
    userIds.add(user.id);
    const role = rolesById.get(user.roleId || user.role);
    if (user.isActive !== false && (!role || role.isActive === false)) {
      throw new ErpSecuritySnapshotError(`El usuario ${user.id} referencia el rol inexistente o inactivo ${user.roleId || user.role}.`);
    }
  });

  return {
    roles,
    users,
    rolesChanged: roleRows !== null,
    usersChanged: userRows !== null,
  };
};
