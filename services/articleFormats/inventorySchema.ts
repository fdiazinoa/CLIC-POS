/** Independent physical history has no Outbox foreign key or financial lifecycle. */
export const FORMAT_INVENTORY_SCHEMA=`
CREATE TABLE IF NOT EXISTS article_format_inventory_originals (
 tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,event_id TEXT NOT NULL,original TEXT NOT NULL,content_hash TEXT NOT NULL,context TEXT NOT NULL,
 PRIMARY KEY(tenant_id,company_id,event_id));
CREATE TABLE IF NOT EXISTS article_format_inventory_effects (
 tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,event_id TEXT NOT NULL,line_id TEXT NOT NULL,item_id TEXT NOT NULL,
 variant_id TEXT,warehouse_id TEXT NOT NULL,delta_base TEXT NOT NULL,return_policy TEXT,
 PRIMARY KEY(tenant_id,company_id,event_id,line_id));
CREATE TABLE IF NOT EXISTS article_format_inventory_links (
 tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,event_id TEXT NOT NULL,scope_key TEXT NOT NULL,
 PRIMARY KEY(tenant_id,company_id,event_id));
CREATE INDEX IF NOT EXISTS article_format_inventory_links_scope ON article_format_inventory_links(scope_key,event_id);
CREATE INDEX IF NOT EXISTS article_format_inventory_effects_item ON article_format_inventory_effects(item_id,warehouse_id,event_id);
CREATE TABLE IF NOT EXISTS article_format_inventory_state (
 scope_key TEXT PRIMARY KEY,generation TEXT NOT NULL,baseline_id TEXT,ordinal TEXT,receipt_id TEXT,checksum TEXT,manifest TEXT);
CREATE INDEX IF NOT EXISTS article_format_inventory_active_scope ON article_format_inventory_state(scope_key) WHERE baseline_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS article_format_inventory_binding (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_key TEXT NOT NULL,authorization TEXT NOT NULL,reservations TEXT);
CREATE TABLE IF NOT EXISTS article_format_inventory_balances (
 scope_key TEXT NOT NULL,item_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,local_id TEXT NOT NULL,qty_physical TEXT NOT NULL,qty_committed TEXT NOT NULL,
 PRIMARY KEY(scope_key,item_id,warehouse_id,local_id));
CREATE TABLE IF NOT EXISTS article_format_inventory_absorptions (
 scope_key TEXT NOT NULL,event_id TEXT NOT NULL,receipt_id TEXT NOT NULL,baseline_id TEXT NOT NULL,evidence TEXT NOT NULL,
 PRIMARY KEY(scope_key,event_id));
CREATE TABLE IF NOT EXISTS article_format_inventory_authorities (
 receipt_id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,baseline_id TEXT NOT NULL,context_token TEXT NOT NULL,authorization TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS article_format_inventory_history (
 receipt_id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,baseline_id TEXT NOT NULL,ordinal TEXT NOT NULL,manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS article_format_inventory_staging (
 receipt_id TEXT NOT NULL,page_index INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(receipt_id,page_index));
`+['originals','effects','links','absorptions','authorities','history'].map(name=>`
CREATE TRIGGER IF NOT EXISTS article_format_inventory_${name}_immutable_update BEFORE UPDATE ON article_format_inventory_${name}
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_INVENTORY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS article_format_inventory_${name}_immutable_delete BEFORE DELETE ON article_format_inventory_${name}
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_INVENTORY_IMMUTABLE'); END;`).join('');
