import { assertParkedTicketsAcknowledged } from '../../utils/parkedTicketAck';
import type { LegacyMutationJournal } from './LegacyMutationJournal';

type Ticket = {
  id?: string;
  tableId?: string | number;
  primaryTableId?: string | number;
  joinedTableIds?: Array<string | number>;
  items?: unknown[];
  total?: number;
};

type Snapshot = { revision?: number; parkedTickets?: unknown };

// These are the only 409 responses emitted by the Android Master for these
// routes, and each is returned before changing restaurant state. Older APKs
// could leave the journal row OUTCOME_UNKNOWN despite recording HTTP 409.
const isProvenPreMutationTableConflict = (method: string, path: string): boolean =>
  (method === 'PUT' && (path === '/api/mesas/parked-tickets' || /^\/api\/tables\/[^/]+$/.test(path)))
  || (method === 'POST' && (path === '/api/mesas/bloquear' || path === '/api/mesas/desbloquear'));

export const reconcileMasterRejectedTableMutations = async (input: {
  journal: LegacyMutationJournal;
  authorityOrigin: string;
  nowMs?: number;
}): Promise<number> => {
  if (!input.journal.isHealthy()) return 0;
  let reconciled = 0;
  for (const entry of input.journal.getBlockingEntries()) {
    const dispatchedAt = Date.parse(entry.dispatchedAt || '');
    if (entry.state !== 'OUTCOME_UNKNOWN'
      || entry.httpStatus !== 409
      || !entry.authorityFingerprint.startsWith(`${input.authorityOrigin}|`)
      || !Number.isFinite(dispatchedAt)
      || (input.nowMs ?? Date.now()) - dispatchedAt < 15_000
      || !isProvenPreMutationTableConflict(entry.method, entry.canonicalPath)) continue;
    await input.journal.acknowledge(entry.id, 'SAFE_PRE_SIDE_EFFECT',
      `RECONCILED_ANDROID_MASTER_TABLE_409:${entry.canonicalPath}`);
    reconciled += 1;
  }
  return reconciled;
};

/** Reconcile only a single, old self-Master table write against the native authority. */
export const reconcileMasterParkedTicketOutcome = async (input: {
  journal: LegacyMutationJournal;
  tickets: Ticket[];
  tableId: string;
  authorityOrigin: string;
  readNativeSnapshot: () => Promise<Snapshot>;
  nowMs?: number;
}): Promise<number | null> => {
  if (!input.tableId || !input.journal.isHealthy()) return null;
  const blocking = input.journal.getBlockingEntries();
  if (blocking.length !== 1) return null;
  const entry = blocking[0];
  const dispatchedAt = Date.parse(entry.dispatchedAt || '');
  if (entry.state !== 'OUTCOME_UNKNOWN'
    || entry.method !== 'PUT'
    || entry.canonicalPath !== '/api/mesas/parked-tickets'
    || !entry.operationCorrelationId.startsWith('MASTER_PARKED_TICKETS_SYNC:')
    || !entry.authorityFingerprint.startsWith(`${input.authorityOrigin}|`)
    || !Number.isFinite(dispatchedAt)
    || (input.nowMs ?? Date.now()) - dispatchedAt < 15_000) return null;

  const snapshot = await input.readNativeSnapshot();
  const revision = Number(snapshot?.revision);
  if (!Number.isFinite(revision) || revision <= 0) return null;
  try {
    // Old journal rows do not record which table was submitted. Require the
    // complete local collection to match the native authority, not only the
    // currently open table, before closing an unknown row.
    assertParkedTicketsAcknowledged(input.tickets, snapshot.parkedTickets);
  } catch {
    return null;
  }
  await input.journal.acknowledge(entry.id, 'RESPONSE_VALID', `RECONCILED_NATIVE_MASTER_SNAPSHOT:${revision}`);
  return revision;
};
