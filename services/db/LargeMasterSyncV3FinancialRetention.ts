/** Remote ACK/fiscal/Z publication may amend these fields, never replace the committed source. */
export const V3_FINANCIAL_MUTABLE_FIELDS = [
  'status', 'updatedAt', 'syncStatus', 'syncError', 'cloudSyncStatus', 'cloudSyncError', 'cloudSyncedAt',
  'fiscalStatus', 'fiscalSyncStatus', 'fiscalSyncError', 'fiscalSyncedAt', 'fiscalReferenceId',
  'fiscalCertifiedNcf', 'fiscalProviderStatus', 'fiscalQrUrl', 'fiscalSecurityCode',
  'fiscalResponseMessage', 'fiscalResponseCode', 'fiscalSignedXml', 'fiscalQrCode', 'fiscalCorrectionAudit',
  'zReportId', 'closedAt', 'closedBy', 'closingId',
] as const;

export const V3_FINANCIAL_RETAINED_UPSERT_SQL = `CASE WHEN documents.collection_name IN ('transactions','transactionHistory')
  AND json_extract(documents.data, '$.v3InventoryBaseline') IS NOT NULL THEN
  json_set(json_patch(documents.data, (SELECT json_group_object(key, json(CASE type
    WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false' ELSE value END)) FROM json_each(excluded.data)
    WHERE key IN (${V3_FINANCIAL_MUTABLE_FIELDS.map(key => `'${key}'`).join(',')}))),
    '$.relatedTransactions', json((SELECT json_group_array(value) FROM (
      SELECT value FROM json_each(documents.data, '$.relatedTransactions')
      UNION SELECT value FROM json_each(excluded.data, '$.relatedTransactions')))))
  ELSE excluded.data END`;
