/** Immutable, terminal scoped snapshots. No legacy catalog or pending event is modified. */
const scope = 'tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, terminal_id TEXT NOT NULL';
const key = 'tenant_id,company_id,terminal_id,sync_id';
const same = 'tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND terminal_id=NEW.terminal_id AND sync_id=NEW.sync_id';

export const ARTICLE_FORMAT_NETWORK_SCHEMA = `
CREATE TABLE IF NOT EXISTS article_format_network_sessions (
 ${scope}, sync_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 context TEXT NOT NULL, manifest TEXT NOT NULL, revision_checksum TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'STAGING' CHECK(state IN ('STAGING','LOCAL_READY','COMPLETE')),
 completion_receipt TEXT, PRIMARY KEY(${key})
);
CREATE TRIGGER IF NOT EXISTS article_format_network_session_conflict BEFORE INSERT ON article_format_network_sessions
WHEN EXISTS (SELECT 1 FROM article_format_network_sessions WHERE ${same}
 AND (revision<>NEW.revision OR context<>NEW.context OR manifest<>NEW.manifest OR revision_checksum<>NEW.revision_checksum))
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_SESSION_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS article_format_network_datasets (
 ${scope}, sync_id TEXT NOT NULL, dataset TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), PRIMARY KEY(${key},dataset),
 FOREIGN KEY(${key}) REFERENCES article_format_network_sessions(${key})
);
CREATE TABLE IF NOT EXISTS article_format_network_chunks (
 ${scope}, sync_id TEXT NOT NULL, dataset TEXT NOT NULL, chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
 raw_text TEXT NOT NULL, checksum TEXT NOT NULL, next_cursor TEXT, page_content TEXT,
 ack_receipt TEXT, PRIMARY KEY(${key},dataset,chunk_index),
 FOREIGN KEY(${key},dataset) REFERENCES article_format_network_datasets(${key},dataset)
);
CREATE TRIGGER IF NOT EXISTS article_format_network_chunk_conflict BEFORE INSERT ON article_format_network_chunks
WHEN EXISTS (SELECT 1 FROM article_format_network_chunks WHERE ${same} AND dataset=NEW.dataset AND chunk_index=NEW.chunk_index
 AND (raw_text<>NEW.raw_text OR checksum<>NEW.checksum OR next_cursor IS NOT NEW.next_cursor OR page_content IS NOT NEW.page_content))
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_PAGE_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS article_format_network_policies (
 ${scope}, sync_id TEXT NOT NULL, item_id TEXT NOT NULL, dto TEXT NOT NULL, policy TEXT NOT NULL,
 PRIMARY KEY(${key},item_id), FOREIGN KEY(${key}) REFERENCES article_format_network_sessions(${key})
);
CREATE TRIGGER IF NOT EXISTS article_format_network_policy_conflict BEFORE INSERT ON article_format_network_policies
WHEN EXISTS (SELECT 1 FROM article_format_network_policies WHERE ${same} AND item_id=NEW.item_id
 AND (dto<>NEW.dto OR policy<>NEW.policy))
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_POLICY_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS article_format_network_active (
 ${scope}, sync_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 PRIMARY KEY(tenant_id,company_id,terminal_id),
 FOREIGN KEY(${key}) REFERENCES article_format_network_sessions(${key})
);
CREATE TRIGGER IF NOT EXISTS article_format_network_activate_insert BEFORE INSERT ON article_format_network_active
WHEN NOT EXISTS (SELECT 1 FROM article_format_network_sessions WHERE ${same} AND revision=NEW.revision
 AND state='COMPLETE' AND completion_receipt IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_REVISION_INCOMPLETE'); END;
CREATE TRIGGER IF NOT EXISTS article_format_network_activate_update BEFORE UPDATE ON article_format_network_active
WHEN NOT EXISTS (SELECT 1 FROM article_format_network_sessions WHERE ${same} AND revision=NEW.revision
 AND state='COMPLETE' AND completion_receipt IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'POS_FORMAT_REVISION_INCOMPLETE'); END;
`;
