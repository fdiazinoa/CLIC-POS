export interface SyncMonitorPageRequest {
    page: number;
    pageSize: number;
    search: string;
    status: 'ALL' | 'PENDING' | 'ERROR';
    terminal: string;
}
export interface SyncMonitorPage {
    collections: Record<string, any[]>;
    total: number;
    blocked: number;
}

const refFields = ['id', 'displayId', 'documentRef', 'reference', 'source_transaction_id', 'source_display_id', 'transactionId', 'saleId', 'ncf', 'electronicNcf'];
const refs = `json_array(${refFields.map(f => `lower(trim(COALESCE(json_extract(data, '$.${f}'), '')))` ).join(',')})`;
const date = (fields: string[]) => `COALESCE(${fields.map(f => `NULLIF(json_extract(data, '$.${f}'), '')`).join(',')}, '1970-01-01T00:00:00.000Z')`;

// SQLite keeps full histories on the native side. Only complete documents belonging
// to the requested page cross the Capacitor bridge; inventory groups stay intact.
export const SYNC_MONITOR_PAGE_SQL = `
WITH base AS (
 SELECT collection_name, doc_id, data,
 CASE collection_name
 WHEN 'transactions' THEN COALESCE(NULLIF(json_extract(data,'$.displayId'),''),doc_id)
 WHEN 'reservations' THEN COALESCE(NULLIF(json_extract(data,'$.code'),''),doc_id)
 WHEN 'zReports' THEN COALESCE(NULLIF(json_extract(data,'$.sequenceNumber'),''),doc_id)
 WHEN 'inventoryLedger' THEN COALESCE(NULLIF(json_extract(data,'$.documentRef'),''),NULLIF(json_extract(data,'$.reference'),''),NULLIF(json_extract(data,'$.source_display_id'),''),doc_id)
 ELSE COALESCE(NULLIF(json_extract(data,'$.sequenceNumber'),''),NULLIF(json_extract(data,'$.displayId'),''),NULLIF(json_extract(data,'$.code'),''),NULLIF(json_extract(data,'$.documentRef'),''),NULLIF(json_extract(data,'$.reference'),''),doc_id) END AS display_id,
 COALESCE(NULLIF(json_extract(data,'$.terminalId'),''),CASE WHEN collection_name IN ('cashMovements','customerMutations','posUserMutations','catalogEdits','wallet_transactions','loyalty_events') THEN NULLIF(json_extract(data,'$.source_terminal_id'),'') END,'-') AS terminal,
 CASE upper(COALESCE(NULLIF(json_extract(data,'$.syncStatus'),''),json_extract(data,'$.cloudSyncStatus'),''))
 WHEN 'ERROR' THEN 2 WHEN 'BLOCKED_FUNCTIONAL' THEN 2 WHEN 'FAILED_FINAL' THEN 2
 WHEN 'COMPLETED' THEN 0 WHEN 'SYNCED' THEN 0 WHEN 'SYNCED_CLOUD' THEN 0
 WHEN 'SYNCED_ACTIVE' THEN 0 WHEN 'SYNCED_MASTER' THEN 0 WHEN 'APPLIED_ERP' THEN 0 ELSE 1 END AS state,
 CASE collection_name
 WHEN 'transactions' THEN ${date(['date','createdAt'])}
 WHEN 'reservations' THEN ${date(['createdAt'])}
 WHEN 'zReports' THEN ${date(['closedAt'])}
 WHEN 'inventoryLedger' THEN ${date(['createdAt','timestamp'])}
 ELSE ${date(['syncBlockedAt','updatedAt','createdAt','timestamp','date'])} END AS date,
 ${refs} AS refs,
 lower(trim(COALESCE(NULLIF(json_extract(data,'$.concept'),''),NULLIF(json_extract(data,'$.concepto'),''),json_extract(data,'$.type'),''))) AS concept
 FROM documents WHERE collection_name IN ('transactions','reservations','inventoryLedger','zReports','cashMovements','customerMutations','posUserMutations','catalogEdits','wallet_transactions','loyalty_events')
), transaction_refs AS (
 SELECT DISTINCT r.value AS ref FROM base t, json_each(t.refs) r
 WHERE t.collection_name='transactions' AND r.value <> ''
), visible AS (
 SELECT *, CASE WHEN collection_name='inventoryLedger'
 THEN collection_name || ':' || lower(trim(display_id)) || '::' || lower(trim(terminal))
 ELSE collection_name || ':' || doc_id END AS group_key
 FROM base b WHERE collection_name <> 'inventoryLedger' OR (
 concept NOT IN ('venta','sale') AND NOT EXISTS (
 SELECT 1 FROM json_each(b.refs) m JOIN transaction_refs t
 ON m.value=t.ref OR (length(m.value)>length(t.ref) AND substr(m.value,1,length(t.ref))=t.ref AND substr(m.value,length(t.ref)+1,1) IN (':','-','_'))
 WHERE m.value <> ''
 ))
), groups AS (
 SELECT group_key, max(state) AS state, max(COALESCE(CASE WHEN typeof(date) IN ('integer','real') THEN julianday(date / 1000.0,'unixepoch') ELSE julianday(date) END,0)) AS sort_date,
 max(CASE WHEN instr(lower(display_id),lower(?))>0 OR instr(lower(COALESCE(json_extract(data,'$.ncf'),'')),lower(?))>0 THEN 1 ELSE 0 END) AS matches_search,
 max(CASE WHEN ?='ALL' OR terminal=? THEN 1 ELSE 0 END) AS matches_terminal
 FROM visible GROUP BY group_key
), filtered AS (
 SELECT * FROM groups WHERE matches_search=1 AND matches_terminal=1
 AND (?='ALL' OR state=CASE WHEN ?='ERROR' THEN 2 ELSE 1 END)
), page AS (
 SELECT group_key FROM filtered ORDER BY sort_date DESC, group_key ASC LIMIT ? OFFSET ?
)
SELECT (SELECT count(*) FROM filtered) AS total,
 (SELECT count(*) FROM groups WHERE state=2) AS blocked,
 COALESCE((SELECT json_group_array(json_object('collection',v.collection_name,'data',json(v.data))) FROM visible v JOIN page p ON v.group_key=p.group_key),'[]') AS records
`;

export const syncMonitorPageParams = (request: SyncMonitorPageRequest): any[] => {
    const size = Math.max(1, Math.min(50, Math.trunc(request.pageSize) || 10));
    return [request.search, request.search, request.terminal, request.terminal,
        request.status, request.status, size, (Math.max(1, Math.trunc(request.page) || 1) - 1) * size];
};

export const decodeSyncMonitorPage = (row: any): SyncMonitorPage => {
    const collections: Record<string, any[]> = {};
    for (const record of JSON.parse(row?.records || '[]')) {
        (collections[record.collection] ||= []).push(record.data);
    }
    return { collections, total: Number(row?.total || 0), blocked: Number(row?.blocked || 0) };
};
