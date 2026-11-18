import { isAuditContextMissing } from './AuditContextRetry';
import type { DatabaseAdapter } from '../db/DatabaseAdapter';

export interface PendingSyncDocument {
  source: string; id: string; reference: string; kind: string; date: string;
  terminal: string; amount: number | null; status: string; attempts: number; reason: string;
}
export interface PendingSyncRequest { page: number; search: string; status: 'ALL' | 'BLOCKED' | 'PENDING'; terminalId?: string; master?: boolean; durableEnabled?: boolean; }
export interface PendingSyncPage { rows: PendingSyncDocument[]; total: number; page: number; pageSize: number; }
const collections = ['customerMutations','posUserMutations','inventoryLedger','cashMovements','zReports','transactions','wallet_transactions','loyalty_events','posAuditEvents','invoiceAuditEvents','catalogEdits','reservations','transfer_receipt_queue'];
const rowsFromSQL = (result: any): Record<string, any>[] => {
  if (!Array.isArray(result) || !result.length) return [];
  if (!Array.isArray(result[0]?.columns) || !Array.isArray(result[0]?.values)) throw new Error('PENDING_DOCUMENTS_RESULT_UNSUPPORTED');
  return result[0].values.map((values: unknown[]) => Object.fromEntries(result[0].columns.map((key: string, index: number) => [key, values[index]])));
};
const value = (path: string) => `json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.${path}')`;
const bounded = (sql: string) => `substr(CAST(COALESCE(${sql},'') AS TEXT),1,240)`;
const state = `upper(COALESCE(NULLIF(${value('syncStatus')},''),NULLIF(${value('cloudSyncStatus')},''),CASE WHEN collection_name='transfer_receipt_queue' THEN ${value('status')} END,CASE WHEN collection_name='transactions' THEN 'PENDING' ELSE '' END))`;
const docTerminal = `COALESCE(${value('terminalId')},${value('source_terminal_id')},${value('payload.terminal_id')},'')`;
const blocked = "('ERROR','BLOCKED_FUNCTIONAL','FAILED_FINAL','REJECTED','BLOCKED')";
const reasonText = (input: unknown): string => {
  const message=String(input || '');
  // A projected/truncated credential value may have no closing quote. Omit the
  // whole detail instead of attempting to reconstruct or partially redact it.
  if (/token|password|secret|authorization|api[_-]?key|bearer/i.test(message)) return 'Detalle omitido por contener posibles credenciales.';
  return message.replace(/https?:\/\/\S+/gi,'[URL omitida]').replace(/[\r\n\t]+/g,' ').slice(0,240);
};

/** SQL projections only: full documents and outbox envelopes never cross the native bridge. */
export async function readPendingSyncDocuments(database: Pick<DatabaseAdapter,'executeSQL'>, request: PendingSyncRequest): Promise<PendingSyncPage> {
  if (!database.executeSQL) throw new Error('PENDING_DOCUMENTS_SQLITE_REQUIRED');
  if(request.master===false&&!request.terminalId?.trim()) throw new Error('PENDING_DOCUMENTS_TERMINAL_REQUIRED');
  const execute = database.executeSQL.bind(database);
  const tables = new Set(rowsFromSQL(await execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('documents','sync_outbox_v2','master_number_ranges')")).map(row=>String(row.name)));
  if (!tables.has('documents')) throw new Error('PENDING_DOCUMENTS_SOURCE_UNAVAILABLE');
  const parts = [`SELECT collection_name AS source,${bounded('doc_id')} AS id,
    ${bounded(`COALESCE(${value('displayId')},${value('sequenceNumber')},${value('code')},${value('documentRef')},${value('reference')},doc_id)`)} AS reference,
    ${bounded(`COALESCE(${value('documentType')},${value('type')},collection_name)`)} AS kind,
    ${bounded(`COALESCE(${value('date')},${value('closedAt')},${value('createdAt')},${value('timestamp')})`)} AS date,
    ${bounded(docTerminal)} AS terminal,CAST(COALESCE(${value('total')},${value('totalAmount')}) AS REAL) AS amount,
    ${state} AS status,CAST(COALESCE(${value('syncAttempts')},${value('attemptCount')},0) AS INTEGER) AS attempts,
    ${bounded(`COALESCE(${value('syncBlockedReason')},${value('syncError')},${value('lastError')},${value('snapshotRefreshError')})`)} AS reason
    FROM documents WHERE collection_name IN (${collections.map(c=>`'${c}'`).join(',')})
    AND COALESCE(${value('_posRecovery.snapshotId')},'')=''
    AND COALESCE(${value('trackingCheckoutId')},'')=''
    AND NOT(collection_name='transactions' AND COALESCE(${value('documentType')},'')='REFUND' AND COALESCE(${value('ncfType')},'')='E34' AND COALESCE(${value('fiscalWorkflowCheckoutId')},'')<>'')
    ${request.durableEnabled ? "AND collection_name NOT IN ('transactions','inventoryLedger')" : ''}
    AND NOT(collection_name='catalogEdits' AND COALESCE(${value('resolution')},'')<>'')
    AND (?=1 OR lower(trim(${docTerminal}))=lower(trim(?)))
    AND (${state} IN ('PENDING','RETRY_WAIT','SYNCING','SENDING','ERROR','BLOCKED_FUNCTIONAL','FAILED_FINAL','REJECTED')
      OR (collection_name='transfer_receipt_queue' AND ${state}='APPLIED' AND ${value('snapshotRefreshPending')}=1))`];
  const scope: unknown[] = [request.master === false ? 0 : 1,request.terminalId || ''];
  if (tables.has('sync_outbox_v2')) {
    const payload = "CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END";
    const outboxTerminal=`COALESCE(json_extract(${payload},'$.terminalId'),json_extract(${payload},'$.terminal_id'),json_extract(${payload},'$.transaction.terminalId'),'')`;
    parts.push(`SELECT 'sync_outbox_v2',${bounded('event_id')},${bounded(`COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.transaction.displayId'),aggregate_id,event_id)`)},${bounded('event_type')},${bounded('created_at')},${bounded(outboxTerminal)},NULL,upper(status),attempt_count,${bounded('last_error')}
      FROM sync_outbox_v2 WHERE status IN ('PENDING','SENDING','RETRY_WAIT','REJECTED')
      AND (?=1 OR lower(trim(${outboxTerminal}))=lower(trim(?)))`);
    scope.push(request.master === false ? 0 : 1,request.terminalId || '');
  }
  if (tables.has('master_number_ranges')) {
    parts.push(`SELECT 'master_number_ranges',${bounded('range_id')},${bounded('prefix')},'Progreso de serie',${bounded('updated_at')},${bounded('terminal_id')},NULL,'PENDING',0,${bounded('blocked_reason')}
      FROM master_number_ranges WHERE status<>'BLOCKED' AND (progress_pending=1 OR COALESCE(last_issued_number,start_number-1)>COALESCE(last_reported_number,start_number-1)) AND (?<>'' AND lower(terminal_id)=lower(?))`);
    scope.push(request.terminalId || '',request.terminalId || '');
  }
  const cte = `WITH entries AS (${parts.join(' UNION ALL ')}), filtered AS (SELECT * FROM entries WHERE (?='ALL' OR (?='BLOCKED' AND status IN ${blocked}) OR (?='PENDING' AND status NOT IN ${blocked})) AND (instr(lower(reference),lower(?))>0 OR instr(lower(id),lower(?))>0))`;
  const search = request.search.slice(0,120);
  const params = [...scope,request.status,request.status,request.status,search,search];
  const total = Number(rowsFromSQL(await execute(`${cte} SELECT COUNT(*) AS total FROM filtered`,params))[0]?.total || 0);
  const pageSize=20, page=Math.min(Math.max(1,Math.trunc(request.page)||1),Math.max(1,Math.ceil(total/pageSize)));
  const records=rowsFromSQL(await execute(`${cte} SELECT * FROM filtered ORDER BY date DESC,source,id LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]));
  return {total,page,pageSize,rows:records.map(row=>({...row,reason:reasonText(row.reason),amount:row.amount == null ? null : Number(row.amount),attempts:Number(row.attempts)||0}) as PendingSyncDocument)};
}

export function pendingSyncDiagnostic(row: PendingSyncDocument): string {
  return JSON.stringify({schemaVersion:1,scope:'Resumen de documento/evento; no incluye payload ni credenciales',document:{...row,reason:reasonText(row.reason)}},null,2);
}

export const canRetryPendingSyncQueue = (row: PendingSyncDocument | null): boolean => Boolean(row && (
  ['PENDING','RETRY_WAIT','SYNCING','SENDING'].includes(row.status)
  || row.source==='transfer_receipt_queue'&&row.status==='APPLIED'
  || row.status==='BLOCKED_FUNCTIONAL'&&isAuditContextMissing(row.source,row.reason)
));

/** The existing sender retains its own ACK/idempotency/blocking policy; never requeue blocked records here. */
export async function retryPendingSyncQueue(sender: {triggerSyncAndWait(): Promise<void>}, online: boolean): Promise<void> {
  if (!online) throw new Error('Sin conexión. No se ha solicitado el reenvío.');
  await sender.triggerSyncAndWait();
}
