import { V3_FINANCIAL_MUTABLE_FIELDS } from './LargeMasterSyncV3FinancialRetention';

// Source status/relatedTransactions and the validated format ACK are exclusively changed by the format transaction.
export const FORMAT_ACK_METADATA_FIELDS = V3_FINANCIAL_MUTABLE_FIELDS.filter(key => key !== 'status');
const keys=FORMAT_ACK_METADATA_FIELDS.map(key=>`'${key}'`).join(',');
export const ARTICLE_FORMAT_RETAINED_UPSERT_SQL = `CASE WHEN json_extract(documents.data,'$.articleFormatEventId') IS NOT NULL
 AND json_extract(documents.data,'$.v3InventoryBaseline') IS NOT NULL THEN json_patch(documents.data,
 (SELECT json_group_object(key,json(CASE type WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null'
 WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE value END)) FROM json_each(excluded.data) WHERE key IN (${keys})))
 ELSE __V3_FINANCIAL_DOCUMENT__ END`;
