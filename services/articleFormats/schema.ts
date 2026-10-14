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
`;
