import type { User } from '../types';

export type SyncedPosUser = User & { syncSource?: 'ERP_SNAPSHOT' };

type PosUserRow = Record<string, unknown>;

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
};

export const resolvePosUserId = (raw: unknown): string => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const row = raw as PosUserRow;
  return asText(
    row.id ??
    row.user_id ??
    row.userId ??
    row.employee_id ??
    row.employeeId ??
    row.code ??
    row.email ??
    row.username
  );
};

export const explicitlyRemovesPosUser = (raw: unknown): boolean => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const row = raw as PosUserRow;
  const operation = asText(row._op ?? row.operation ?? row.action).toUpperCase();
  const canOperatePos = asBoolean(
    row.puede_operar_pos ??
    row.can_operate_pos ??
    row.canOperatePos ??
    row.allow_pos_access ??
    row.allowPosAccess ??
    row.pos_enabled ??
    row.posEnabled
  );
  const isActive = asBoolean(row.is_active ?? row.isActive ?? row.active);
  const deletedAt = asText(row.deleted_at ?? row.deletedAt);

  return operation === 'DELETE'
    || operation === 'REMOVE'
    || canOperatePos === false
    || isActive === false
    || Boolean(deletedAt);
};

export interface ReconcilePosUsersOptions {
  existingUsers: SyncedPosUser[];
  incomingUsers: SyncedPosUser[];
  explicitlyRemovedIds?: Iterable<string>;
  allowAuthoritativeReplacement?: boolean;
}

/** Preserve offline POS credentials when ERP returns a terminal-scoped or partial roster. */
export const reconcilePosUsers = ({
  existingUsers,
  incomingUsers,
  explicitlyRemovedIds = [],
  allowAuthoritativeReplacement = false,
}: ReconcilePosUsersOptions): SyncedPosUser[] => {
  const existing = Array.isArray(existingUsers) ? existingUsers : [];
  const incoming = Array.isArray(incomingUsers) ? incomingUsers : [];
  const removedIds = new Set(Array.from(explicitlyRemovedIds, (id) => asText(id)).filter(Boolean));
  const incomingById = new Map<string, SyncedPosUser>();

  incoming.forEach((user) => {
    const id = resolvePosUserId(user);
    if (!id || removedIds.has(id)) return;
    incomingById.set(id, { ...user, id });
  });

  const existingById = new Map<string, SyncedPosUser>();
  existing.forEach((user) => {
    const id = resolvePosUserId(user);
    if (id) existingById.set(id, user);
  });

  const nextById = new Map<string, SyncedPosUser>();
  existingById.forEach((user, id) => {
    if (incomingById.has(id) || removedIds.has(id)) return;
    if (allowAuthoritativeReplacement && user.syncSource === 'ERP_SNAPSHOT') return;
    nextById.set(id, user);
  });

  incomingById.forEach((user, id) => {
    const previous = existingById.get(id);
    nextById.set(id, {
      ...(previous || {}),
      ...user,
      id,
      pin: user.pin || previous?.pin || '',
      photo: user.photo || previous?.photo,
      biometrics: user.biometrics ?? previous?.biometrics,
    });
  });

  return Array.from(nextById.values());
};
