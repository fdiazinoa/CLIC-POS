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

const ticketReferencesTable = (ticket: Ticket, tableId: string): boolean =>
  String(ticket.tableId || '') === tableId || String(ticket.primaryTableId || '') === tableId
  || (Array.isArray(ticket.joinedTableIds) && ticket.joinedTableIds.some(id => String(id) === tableId));

type Snapshot = { revision?: number; parkedTickets?: unknown };

/** Full-account retirement can be proved from the persisted intent after a lost ACK or restart. */
export const reconcileRetiredTableAccountOutcome = async (input: {
  journal: LegacyMutationJournal;
  authorityOrigin: string;
  terminalId: string;
  readSnapshot: () => Promise<Snapshot>;
  fenceOldLock?: (lock: { tableId: string; ownerId: string; token: string }) => Promise<boolean>;
}): Promise<boolean> => {
  if (!input.journal.isHealthy()) return false;
  const blocking = input.journal.getBlockingEntries();
  if (blocking.length !== 1) return false;
  const entry = blocking[0];
  const context = entry.reconciliationContext;
  const tableId = String(context?.tableId || '').trim();
  const sourceId = String(context?.sourceId || '').trim();
  const expected = context?.expectedTableTickets;
  if (entry.state !== 'OUTCOME_UNKNOWN'
    || entry.method !== 'PUT'
    || entry.canonicalPath !== '/api/mesas/parked-tickets'
    || !/^(?:PARKED_TICKETS_SYNC|MASTER_PARKED_TICKETS_SYNC):/.test(entry.operationCorrelationId)
    || entry.authorityFingerprint !== `${input.authorityOrigin}|${input.terminalId}`
    || context?.kind !== 'TABLE_ACCOUNT_RETIRE_V1'
    || !tableId || !sourceId || !Array.isArray(expected)
    || !expected.some((ticket: Ticket) => ticketReferencesTable(ticket, tableId)
      && ticket.items?.some(item => String((item as { transferredFromTicketId?: string })?.transferredFromTicketId || '') === sourceId))
    || expected.some((ticket: Ticket) => String(ticket?.id || '') === sourceId)) return false;
  const matches = (snapshot: Snapshot, submitted: Ticket[], sourceMustExist: boolean): boolean => {
    if (!Array.isArray(snapshot?.parkedTickets)) return false;
    const hasSource = snapshot.parkedTickets.some((ticket: Ticket) => String(ticket?.id || '') === sourceId);
    if (hasSource !== sourceMustExist) return false;
    try {
      assertParkedTicketsAcknowledged(submitted, snapshot.parkedTickets, '', tableId);
      return true;
    } catch {
      return false;
    }
  };
  const first = await input.readSnapshot();
  if (matches(first, expected as Ticket[], false)) {
    await input.journal.acknowledge(entry.id, 'RESPONSE_VALID',
      `RECONCILED_TABLE_ACCOUNT_RETIRE_SNAPSHOT:${first.revision ?? 'UNVERSIONED'}`);
    return true;
  }
  const pre = context?.preTableTickets;
  const lock = {
    tableId,
    ownerId: String(context?.lockOwnerId || '').trim(),
    token: String(context?.lockToken || '').trim(),
  };
  if (!Array.isArray(pre) || !pre.some((ticket: Ticket) => String(ticket?.id || '') === sourceId && ticketReferencesTable(ticket, tableId))
    || !lock.ownerId || !lock.token || !input.fenceOldLock
    || !matches(first, pre as Ticket[], true)) return false;
  // A successful release (or an ownership-mismatch proving the old token is
  // already gone) is a server-side barrier. A delayed PUT with that token can
  // no longer apply; read the authoritative state again only after the fence.
  if (!await input.fenceOldLock(lock)) return false;
  const afterFence = await input.readSnapshot();
  if (matches(afterFence, expected as Ticket[], false)) {
    await input.journal.acknowledge(entry.id, 'RESPONSE_VALID',
      `RECONCILED_TABLE_ACCOUNT_RETIRE_AFTER_FENCE:${afterFence.revision ?? 'UNVERSIONED'}`);
    return true;
  }
  if (!matches(afterFence, pre as Ticket[], true)) return false;
  await input.journal.acknowledge(entry.id, 'SAFE_PRE_SIDE_EFFECT',
    `RECONCILED_TABLE_ACCOUNT_RETIRE_NOT_APPLIED:${afterFence.revision ?? 'UNVERSIONED'}`);
  return true;
};

/** Cold-start recovery uses only the journal's already-pinned Master origin. */
export const reconcileClientRetiredAccountBeforeAuthorityAssertion = async (input: {
  journal: LegacyMutationJournal;
  authorityBaseUrl: string | null;
  terminalId: string;
  fetcher?: typeof fetch;
}): Promise<boolean> => {
  if (!input.authorityBaseUrl || !input.terminalId || !input.journal.hasOutcomeUnknown()) return false;
  let origin: string;
  try { origin = new URL(input.authorityBaseUrl).origin; }
  catch { return false; }
  const request = async (path: string, body?: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await (input.fetcher || fetch)(`${origin}${path}`, {
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const data = await response.json();
      return { response, data };
    } finally { clearTimeout(timeout); }
  };
  try {
    return await reconcileRetiredTableAccountOutcome({
      journal: input.journal, authorityOrigin: origin, terminalId: input.terminalId,
      readSnapshot: async () => {
        const { response, data } = await request('/api/mesas');
        if (!response.ok || !Array.isArray(data?.parkedTickets)) throw new Error('MASTER_TABLES_MISSING_TICKETS');
        return data;
      },
      fenceOldLock: async lock => {
        const { response, data } = await request('/api/mesas/desbloquear', lock);
        return (response.ok && data?.success === true)
          || (response.status === 409 && data?.code === 'TABLE_EDIT_LOCK_OWNERSHIP_MISMATCH');
      },
    });
  } catch {
    return false;
  }
};

// Older APKs could leave these proven pre-mutation table conflicts as
// OUTCOME_UNKNOWN with no contract marker. V2 rows retain their exact server
// classification and must never be closed by this legacy-only recovery.
const isProvenPreMutationTableConflict = (method: string, path: string): boolean =>
  (method === 'PUT' && (path === '/api/mesas/parked-tickets' || /^\/api\/tables\/[^/]+$/.test(path)))
  || (method === 'POST' && (
    path === '/api/mesas/bloquear'
    || path === '/api/mesas/desbloquear'
    || path === '/api/mesas/liberar'
  ));

export const reconcileMasterRejectedTableMutations = async (input: {
  journal: LegacyMutationJournal;
  authorityOrigin: string;
  terminalId: string;
  generation: number;
  nowMs?: number;
}): Promise<number> => {
  if (!input.journal.isHealthy()) return 0;
  let reconciled = 0;
  for (const entry of input.journal.getBlockingEntries()) {
    const dispatchedAt = Date.parse(entry.dispatchedAt || '');
    const rawContractVersion = entry.reconciliationContext?.legacyMutationContractVersion;
    const isLegacyContract = rawContractVersion === undefined
      || (typeof rawContractVersion === 'number'
        && Number.isFinite(rawContractVersion)
        && rawContractVersion < 2);
    // Both 409 variants exposed by /api/mesas/liberar are decided before any
    // restaurant mutation. Android 1.1.460 nevertheless persisted them as V2
    // OUTCOME_UNKNOWN rows, so allow that exact endpoint to recover as well.
    // The in-memory authority generation restarts with the WebView; the durable
    // origin + terminal fingerprint remains the identity fence for this case.
    const isKnownReleaseRejection = entry.method === 'POST'
      && entry.canonicalPath === '/api/mesas/liberar';
    if (entry.state !== 'OUTCOME_UNKNOWN'
      || entry.httpStatus !== 409
      || entry.authorityFingerprint !== `${input.authorityOrigin}|${input.terminalId}`
      || (!isKnownReleaseRejection && entry.generation !== input.generation)
      || (!isLegacyContract && !isKnownReleaseRejection)
      || !Number.isFinite(dispatchedAt)
      || (input.nowMs ?? Date.now()) - dispatchedAt < 15_000
      || !isProvenPreMutationTableConflict(entry.method, entry.canonicalPath)) continue;
    await input.journal.acknowledge(entry.id, 'SAFE_PRE_SIDE_EFFECT',
      `RECONCILED_ANDROID_MASTER_TABLE_409:${entry.canonicalPath}`);
    reconciled += 1;
  }
  return reconciled;
};

export const reconcileLegacyClientTableConflictBeforeAuthorityAssertion = async (input: {
  journal: LegacyMutationJournal;
  authorityBaseUrl: string;
  terminalId: string;
  generation: number;
  nowMs?: number;
}): Promise<number> => {
  if (!input.journal.hasOutcomeUnknown()) return 0;
  const terminalId = String(input.terminalId || '').trim();
  if (!terminalId || !input.authorityBaseUrl) return 0;
  let authorityOrigin: string;
  try {
    authorityOrigin = new URL(input.authorityBaseUrl).origin;
  } catch {
    return 0;
  }
  return reconcileMasterRejectedTableMutations({
    journal: input.journal,
    authorityOrigin,
    terminalId,
    generation: input.generation,
    nowMs: input.nowMs,
  });
};

export const resolveColdBootstrapLegacyRecoveryGeneration = (authorityState: {
  masterUrl: string | null;
  terminalId: string | null;
  revision: number;
}): number => authorityState.revision === 0
  && authorityState.masterUrl === null
  && authorityState.terminalId === null
    ? 1
    : authorityState.revision;

/** Reconcile only a single, old self-Master table write against the native authority. */
export const reconcileMasterParkedTicketOutcome = async (input: {
  journal: LegacyMutationJournal;
  tickets: Ticket[];
  tableId?: string;
  authorityOrigin: string;
  readNativeSnapshot: () => Promise<Snapshot>;
  nowMs?: number;
}): Promise<number | null> => {
  if (!input.journal.isHealthy()) return null;
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
