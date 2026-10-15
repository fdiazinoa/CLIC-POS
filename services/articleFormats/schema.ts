import {FORMAT_INVENTORY_SCHEMA} from './inventorySchema';
import { FORMAT_ACK_METADATA_FIELDS } from '../db/ArticleFormatFinancialRetention';
/** Additive tables only. Existing collections/sync_queue and pending legacy sales stay intact. */
export const ARTICLE_FORMATS_SCHEMA = `
CREATE TABLE IF NOT EXISTS article_format_master_pages (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, page_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0), content TEXT NOT NULL,
  next_cursor TEXT, acked INTEGER NOT NULL DEFAULT 0 CHECK(acked IN (0,1)),
  PRIMARY KEY(tenant_id, company_id, page_id)
);
CREATE TRIGGER IF NOT EXISTS article_format_page_conflict BEFORE INSERT ON article_format_master_pages
WHEN EXISTS (SELECT 1 FROM article_format_master_pages WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id
 AND page_id=NEW.page_id AND content<>NEW.content)
BEGIN SELECT RAISE(ABORT, 'ARTICLE_FORMAT_PAGE_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS article_format_revisions (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0), content TEXT NOT NULL,
  PRIMARY KEY(tenant_id, company_id, item_id, revision)
);
CREATE TRIGGER IF NOT EXISTS article_format_revision_conflict BEFORE INSERT ON article_format_revisions
WHEN EXISTS (SELECT 1 FROM article_format_revisions WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id
 AND item_id=NEW.item_id AND revision=NEW.revision AND content<>NEW.content)
BEGIN SELECT RAISE(ABORT, 'ARTICLE_FORMAT_REVISION_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS article_formats (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, item_id TEXT NOT NULL, revision INTEGER NOT NULL,
  variant_key TEXT NOT NULL, format_id TEXT NOT NULL, barcode TEXT, content TEXT NOT NULL,
  PRIMARY KEY(tenant_id,company_id,item_id,revision,variant_key,format_id),
  FOREIGN KEY(tenant_id,company_id,item_id,revision) REFERENCES article_format_revisions(tenant_id,company_id,item_id,revision)
);
CREATE INDEX IF NOT EXISTS article_formats_barcode ON article_formats(tenant_id,company_id,barcode);
CREATE TABLE IF NOT EXISTS article_format_prices (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, item_id TEXT NOT NULL, revision INTEGER NOT NULL,
  variant_key TEXT NOT NULL, format_id TEXT NOT NULL, tariff_id TEXT NOT NULL, price TEXT NOT NULL,
  PRIMARY KEY(tenant_id,company_id,item_id,revision,variant_key,format_id,tariff_id),
  FOREIGN KEY(tenant_id,company_id,item_id,revision,variant_key,format_id)
   REFERENCES article_formats(tenant_id,company_id,item_id,revision,variant_key,format_id)
);
CREATE TABLE IF NOT EXISTS article_format_outbox (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, event_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('SALE','REFUND','VOID')),
  content TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACKED')),
  PRIMARY KEY(tenant_id,company_id,event_id)
);
CREATE TRIGGER IF NOT EXISTS article_format_event_conflict BEFORE INSERT ON article_format_outbox
WHEN EXISTS (SELECT 1 FROM article_format_outbox WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id
 AND event_id=NEW.event_id AND content<>NEW.content)
BEGIN SELECT RAISE(ABORT, 'ARTICLE_FORMAT_EVENT_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS article_format_sale_lines (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, event_id TEXT NOT NULL, line_id TEXT NOT NULL,
  item_id TEXT NOT NULL, snapshot TEXT NOT NULL, sold_base INTEGER NOT NULL CHECK(sold_base > 0), content TEXT NOT NULL,
  PRIMARY KEY(tenant_id,company_id,event_id,line_id),
  FOREIGN KEY(tenant_id,company_id,event_id) REFERENCES article_format_outbox(tenant_id,company_id,event_id)
);
CREATE TABLE IF NOT EXISTS article_format_returns (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, event_id TEXT NOT NULL, line_id TEXT NOT NULL,
  sale_event_id TEXT NOT NULL, sale_line_id TEXT NOT NULL, snapshot TEXT NOT NULL,
  returned_base INTEGER NOT NULL CHECK(returned_base > 0),
  physical_return TEXT NOT NULL CHECK(physical_return IN ('RESTOCK','DAMAGED','NO_RETURN')),
  PRIMARY KEY(tenant_id,company_id,event_id,line_id),
  FOREIGN KEY(tenant_id,company_id,event_id) REFERENCES article_format_outbox(tenant_id,company_id,event_id),
  FOREIGN KEY(tenant_id,company_id,sale_event_id,sale_line_id)
   REFERENCES article_format_sale_lines(tenant_id,company_id,event_id,line_id)
);
CREATE TRIGGER IF NOT EXISTS article_format_return_limit BEFORE INSERT ON article_format_returns
WHEN NOT EXISTS (SELECT 1 FROM article_format_returns WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id
 AND event_id=NEW.event_id AND line_id=NEW.line_id)
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM article_format_sale_lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id
 AND event_id=NEW.sale_event_id AND line_id=NEW.sale_line_id AND snapshot=NEW.snapshot)
 THEN RAISE(ABORT,'ARTICLE_FORMAT_ORIGINAL_LINE_MISSING_OR_CHANGED')
 WHEN NEW.returned_base + COALESCE((SELECT SUM(returned_base) FROM article_format_returns
 WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND sale_event_id=NEW.sale_event_id AND sale_line_id=NEW.sale_line_id),0)
 > (SELECT sold_base FROM article_format_sale_lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id
 AND event_id=NEW.sale_event_id AND line_id=NEW.sale_line_id)
 THEN RAISE(ABORT,'ARTICLE_FORMAT_REFUND_EXCEEDS_SALE') END;
END;
CREATE TABLE IF NOT EXISTS article_format_base_movements (
  tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, event_id TEXT NOT NULL, line_id TEXT NOT NULL,
  item_id TEXT NOT NULL, variant_key TEXT NOT NULL, warehouse_id TEXT NOT NULL,
  base_delta INTEGER NOT NULL, base_unit_cost TEXT NOT NULL,
  PRIMARY KEY(tenant_id,company_id,event_id,line_id),
  FOREIGN KEY(tenant_id,company_id,event_id) REFERENCES article_format_outbox(tenant_id,company_id,event_id)
);
`+FORMAT_INVENTORY_SCHEMA;

export const ARTICLE_FORMAT_WIRE_SCHEMA = `
CREATE TABLE IF NOT EXISTS article_format_wire_events (
 tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,event_id TEXT NOT NULL,transaction_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,context TEXT NOT NULL,policies TEXT NOT NULL,ack TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT,
 PRIMARY KEY(tenant_id,company_id,event_id),UNIQUE(tenant_id,company_id,transaction_id),
 FOREIGN KEY(tenant_id,company_id,event_id) REFERENCES article_format_outbox(tenant_id,company_id,event_id)
);

CREATE TABLE IF NOT EXISTS article_format_wire_write_scope (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER IF NOT EXISTS article_format_wire_legacy_insert BEFORE INSERT ON collections
WHEN NEW.key IN ('transactions','transactionHistory','payments','internalSequences','globalSequenceCounter','inventoryLedger','productStocks','products','localFiscalBuffer')
 AND EXISTS (SELECT 1 FROM article_format_wire_events) AND NOT EXISTS (SELECT 1 FROM article_format_wire_write_scope)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_LEGACY_WRITER_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS article_format_wire_legacy_update BEFORE UPDATE ON collections
WHEN NEW.key IN ('transactions','transactionHistory','payments','internalSequences','globalSequenceCounter','inventoryLedger','productStocks','products','localFiscalBuffer')
 AND EXISTS (SELECT 1 FROM article_format_wire_events) AND NOT EXISTS (SELECT 1 FROM article_format_wire_write_scope)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_LEGACY_WRITER_FORBIDDEN'); END;
`;

/** Native guards protect format-owned financial documents without freezing the legacy/V3 POS. */
export function articleFormatWireSchema(layout?: 'DOCUMENTS'): string {
 if (layout !== 'DOCUMENTS') return ARTICLE_FORMAT_WIRE_SCHEMA;
 const tables = ARTICLE_FORMAT_WIRE_SCHEMA.slice(0, ARTICLE_FORMAT_WIRE_SCHEMA.indexOf('CREATE TRIGGER'));
 return tables + `
DROP TRIGGER IF EXISTS article_format_document_insert;
DROP TRIGGER IF EXISTS article_format_document_update;
DROP TRIGGER IF EXISTS article_format_document_delete;
CREATE INDEX IF NOT EXISTS article_format_outbox_source ON article_format_outbox(tenant_id,company_id,json_extract(content,'$.source_event_id'));
CREATE INDEX IF NOT EXISTS article_format_fiscal_buffer_scope ON documents(json_extract(data,'$.type'),json_extract(data,'$.terminalId')) WHERE collection_name='localFiscalBuffer';
CREATE TRIGGER IF NOT EXISTS article_format_document_insert BEFORE INSERT ON documents
WHEN json_extract(NEW.data,'$.articleFormatEventId') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.collection_name=NEW.collection_name AND d.doc_id=NEW.doc_id
  AND json_extract(d.data,'$.v3InventoryBaseline') IS NOT NULL
  AND json_extract(d.data,'$.articleFormatEventId')=json_extract(NEW.data,'$.articleFormatEventId'))
 AND NOT EXISTS (SELECT 1 FROM article_format_wire_write_scope)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_LEGACY_WRITER_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS article_format_document_update BEFORE UPDATE ON documents
WHEN (json_extract(NEW.data,'$.articleFormatEventId') IS NOT NULL OR json_extract(OLD.data,'$.articleFormatEventId') IS NOT NULL)
 AND (json_extract(OLD.data,'$.v3InventoryBaseline') IS NULL OR EXISTS (
   SELECT 1 FROM json_each(OLD.data) original WHERE original.key NOT IN (${FORMAT_ACK_METADATA_FIELDS.map(k=>`'${k}'`).join(',')})
   AND NOT EXISTS(SELECT 1 FROM json_each(NEW.data) incoming WHERE incoming.key=original.key AND incoming.type=original.type AND incoming.value IS original.value))
  OR EXISTS(SELECT 1 FROM json_each(NEW.data) incoming WHERE incoming.key NOT IN (${FORMAT_ACK_METADATA_FIELDS.map(k=>`'${k}'`).join(',')})
   AND NOT EXISTS(SELECT 1 FROM json_each(OLD.data) original WHERE incoming.key=original.key AND incoming.type=original.type AND incoming.value IS original.value)))
 AND NOT EXISTS (SELECT 1 FROM article_format_wire_write_scope)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_LEGACY_WRITER_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS article_format_document_delete BEFORE DELETE ON documents
WHEN json_extract(OLD.data,'$.articleFormatEventId') IS NOT NULL
 AND json_extract(OLD.data,'$.v3InventoryBaseline') IS NULL
 AND NOT EXISTS (SELECT 1 FROM article_format_wire_write_scope)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_LEGACY_WRITER_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS article_format_native_document_retain BEFORE DELETE ON documents
WHEN json_extract(OLD.data,'$.articleFormatEventId') IS NOT NULL AND json_extract(OLD.data,'$.v3InventoryBaseline') IS NOT NULL
BEGIN SELECT RAISE(IGNORE); END;
`;
}
