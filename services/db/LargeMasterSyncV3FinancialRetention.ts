/** Remote ACK/fiscal/Z publication may amend these fields, never replace the committed source. */
export const V3_FINANCIAL_MUTABLE_FIELDS = [
  'status', 'updatedAt', 'syncStatus', 'syncError', 'cloudSyncStatus', 'cloudSyncError', 'cloudSyncedAt',
  'syncStartedAt', 'syncRetryAfter', 'syncBlockedReason', 'syncBlockedAt', '_forceSyncReplay',
  'fiscalStatus', 'fiscalSyncStatus', 'fiscalSyncError', 'fiscalSyncedAt', 'fiscalReferenceId',
  'fiscalCertifiedNcf', 'fiscalProviderStatus', 'fiscalQrUrl', 'fiscalSecurityCode',
  'fiscalResponseMessage', 'fiscalResponseCode', 'fiscalSignedXml', 'fiscalQrCode', 'fiscalCorrectionAudit',
  'zReportId', 'closedAt', 'closedBy', 'closingId',
] as const;

const transientSyncFields = ['syncStartedAt', 'syncRetryAfter', 'syncBlockedReason', 'syncBlockedAt', '_forceSyncReplay'];
const mutableKeysSql = V3_FINANCIAL_MUTABLE_FIELDS.map(key => `'${key}'`).join(',');
// BackgroundSyncManager clears fields with delete/undefined. Only a complete local
// source-identical save may interpret absence as deletion; a remote partial ACK must not.
const localCompleteSourceSql = `json_extract(excluded.data, '$.v3CommitFingerprint') IS NOT NULL
  AND json_extract(excluded.data, '$.v3CommitFingerprint') = json_extract(documents.data, '$.v3CommitFingerprint')
  AND NOT EXISTS (SELECT 1 FROM json_each(documents.data) original
    WHERE original.key NOT IN (${mutableKeysSql}, 'relatedTransactions')
    AND NOT EXISTS (SELECT 1 FROM json_each(excluded.data) incoming
      WHERE incoming.key = original.key AND incoming.type = original.type AND incoming.value IS original.value))`;

export const V3_FINANCIAL_RETAINED_UPSERT_SQL = `CASE WHEN documents.collection_name IN ('transactions','transactionHistory')
  AND json_extract(documents.data, '$.v3InventoryBaseline') IS NOT NULL THEN
  json_set(json_patch(CASE WHEN ${localCompleteSourceSql}
    THEN json_remove(documents.data, ${transientSyncFields.map(key => `'$.${key}'`).join(',')})
    ELSE documents.data END, (SELECT json_group_object(key, json(CASE type
    WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false' ELSE value END)) FROM json_each(excluded.data)
    WHERE key IN (${mutableKeysSql}))),
    '$.relatedTransactions', json((SELECT json_group_array(value) FROM (
      SELECT value FROM json_each(documents.data, '$.relatedTransactions')
      UNION SELECT value FROM json_each(excluded.data, '$.relatedTransactions')))))
  ELSE excluded.data END`;
