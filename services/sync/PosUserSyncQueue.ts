import { v4 as uuidv4 } from 'uuid';
import type { SyncStatus, User } from '../../types';
import { db } from '../../utils/db';
import { isDefaultSeedPosUser } from '../../utils/posUserReconciliation';
import { permissionService } from './PermissionService';

export type PosUserMutationOperation = 'UPSERT' | 'DELETE';

export interface PosUserMutationPayload {
  sourceUserId: string;
  name: string;
  pin: string;
  role: string;
  terminalScope: 'SELECTED';
  terminalIds: string[];
  isActive: boolean;
}

export interface PosUserMutation {
  id: string;
  sourceUserId: string;
  operation: PosUserMutationOperation;
  user?: PosUserMutationPayload;
  terminalId: string;
  createdAt: string;
  updatedAt: string;
  payloadFingerprint: string;
  syncStatus: SyncStatus;
  syncError?: string;
}

const asText = (value: unknown): string => String(value ?? '').trim();

export const buildPosUserMutationPayload = (
  user: User,
  terminalId: string,
): PosUserMutationPayload => ({
  sourceUserId: asText(user.id),
  name: asText(user.name),
  pin: asText(user.pin),
  role: asText(user.roleId || user.role).toUpperCase() || 'CASHIER',
  terminalScope: 'SELECTED',
  terminalIds: [terminalId],
  isActive: true,
});

export const posUserMutationFingerprint = (
  operation: PosUserMutationOperation,
  sourceUserId: string,
  payload?: PosUserMutationPayload,
): string => JSON.stringify({ operation, sourceUserId, payload: payload || null });

const currentTerminalId = (): string => (
  asText(permissionService.getTerminalId()) || 'LOCAL'
);

export const queuePosUserMutation = async (
  operation: PosUserMutationOperation,
  user: User,
): Promise<PosUserMutation | null> => {
  if (!user?.id || isDefaultSeedPosUser(user)) return null;

  const terminalId = currentTerminalId();
  const payload = operation === 'UPSERT'
    ? buildPosUserMutationPayload(user, terminalId)
    : undefined;
  const payloadFingerprint = posUserMutationFingerprint(operation, asText(user.id), payload);
  const existing = await db.get('posUserMutations') as PosUserMutation[];
  const duplicate = Array.isArray(existing)
    ? existing.find((mutation) => mutation.payloadFingerprint === payloadFingerprint)
    : undefined;
  if (duplicate) return null;

  const now = new Date().toISOString();
  const mutation: PosUserMutation = {
    id: uuidv4(),
    sourceUserId: asText(user.id),
    operation,
    ...(payload ? { user: payload } : {}),
    terminalId,
    createdAt: now,
    updatedAt: now,
    payloadFingerprint,
    syncStatus: 'PENDING',
  };
  await db.saveDocument('posUserMutations', mutation);
  return mutation;
};

export const queuePosUserRosterChanges = async (
  previousUsers: User[],
  nextUsers: User[],
): Promise<number> => {
  const previousById = new Map(previousUsers.map((user) => [asText(user.id), user]));
  const nextById = new Map(nextUsers.map((user) => [asText(user.id), user]));
  let queued = 0;

  for (const user of nextUsers) {
    if (isDefaultSeedPosUser(user)) continue;
    const previous = previousById.get(asText(user.id));
    const terminalId = currentTerminalId();
    const beforeFingerprint = previous
      ? posUserMutationFingerprint('UPSERT', asText(previous.id), buildPosUserMutationPayload(previous, terminalId))
      : null;
    const afterFingerprint = posUserMutationFingerprint('UPSERT', asText(user.id), buildPosUserMutationPayload(user, terminalId));
    if (beforeFingerprint === afterFingerprint) continue;
    if (await queuePosUserMutation('UPSERT', user)) queued++;
  }

  for (const user of previousUsers) {
    if (isDefaultSeedPosUser(user) || nextById.has(asText(user.id))) continue;
    if (await queuePosUserMutation('DELETE', user)) queued++;
  }

  return queued;
};

/** Queue legacy/local users such as Felix once after upgrading the APK. */
export const queueUnsyncedLocalPosUsers = async (users: User[]): Promise<number> => {
  let queued = 0;
  for (const user of users) {
    if (isDefaultSeedPosUser(user) || user.syncSource === 'ERP_SNAPSHOT') continue;
    if (await queuePosUserMutation('UPSERT', user)) queued++;
  }
  return queued;
};
