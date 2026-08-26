import type { User } from '../types';

export type SyncedPosUser = User;

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

const LEGACY_DEFAULT_POS_USERS = new Map([
  ['u1', { name: 'Admin Master', role: 'ADMIN' }],
  ['u2', { name: 'Cajero Principal', role: 'CASHIER' }],
  ['u3', { name: 'Supervisor Turno', role: 'SUPERVISOR' }],
]);

/** Detect both newly tagged seeds and the same users persisted by older APKs. */
export const isDefaultSeedPosUser = (user: unknown): boolean => {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return false;
  const candidate = user as SyncedPosUser;
  if (candidate.syncSource === 'ERP_SNAPSHOT') return false;
  if (candidate.syncSource === 'LOCAL_SEED') return true;

  const legacySeed = LEGACY_DEFAULT_POS_USERS.get(asText(candidate.id));
  return Boolean(
    legacySeed
    && asText(candidate.name) === legacySeed.name
    && asText(candidate.roleId ?? candidate.role).toUpperCase() === legacySeed.role
  );
};

export const withoutDefaultSeedPosUsers = (users: unknown): SyncedPosUser[] => (
  Array.isArray(users)
    ? (users as SyncedPosUser[]).filter((user) => !isDefaultSeedPosUser(user))
    : []
);

export const hasErpSnapshotPosUsers = (users: unknown): boolean => (
  Array.isArray(users)
  && (users as SyncedPosUser[]).some((user) => user?.syncSource === 'ERP_SNAPSHOT')
);

export interface SelectPosUsersForRuntimeOptions {
  erpManaged: boolean;
  fallbackUsers?: SyncedPosUser[];
}

/**
 * ERP users take precedence over demo seeds. A locally-created operator is not
 * proof that the ERP roster arrived, so keep the seeds available until at least
 * one real ERP snapshot user exists. Local operators always remain visible.
 */
export const selectPosUsersForRuntime = (
  users: unknown,
  { erpManaged, fallbackUsers = [] }: SelectPosUsersForRuntimeOptions,
): SyncedPosUser[] => {
  const localUsers = Array.isArray(users) ? users as SyncedPosUser[] : [];
  if (!erpManaged) return localUsers;

  const operationalUsers = withoutDefaultSeedPosUsers(localUsers);
  if (hasErpSnapshotPosUsers(localUsers)) return operationalUsers;

  const preservedSeeds = localUsers.filter(isDefaultSeedPosUser);
  if (preservedSeeds.length > 0) return [...preservedSeeds, ...operationalUsers];

  return [...fallbackUsers.filter(isDefaultSeedPosUser), ...operationalUsers];
};

export const posUserRostersMatch = (left: unknown, right: unknown): boolean => {
  const normalize = (value: unknown) => (Array.isArray(value) ? value : [])
    .map((entry) => {
      const user = entry as SyncedPosUser;
      return {
        id: asText(user?.id),
        name: asText(user?.name),
        pin: asText(user?.pin),
        role: asText(user?.role),
        roleId: asText(user?.roleId),
        photo: asText(user?.photo),
        syncSource: asText(user?.syncSource),
        biometrics: user?.biometrics ?? null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
};

export const resolvePosUserId = (raw: unknown): string => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const row = raw as PosUserRow;
  return asText(
    row.source_pos_user_id ??
    row.sourcePosUserId ??
    row.source_user_id ??
    row.sourceUserId ??
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
  removeDefaultSeedUsers?: boolean;
}

/** Preserve offline POS credentials when ERP returns a terminal-scoped or partial roster. */
export const reconcilePosUsers = ({
  existingUsers,
  incomingUsers,
  explicitlyRemovedIds = [],
  allowAuthoritativeReplacement = false,
  removeDefaultSeedUsers = false,
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
    if (removeDefaultSeedUsers && incomingById.size > 0 && isDefaultSeedPosUser(user)) return;
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
