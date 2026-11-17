import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { authorizationQueueItem, persistAuthorizationLog } from '../services/audit/PosOperationalAudit';

// Exercise the actual Capacitor adapter against real SQLite/WASM SQL, without
// claiming that the JavaScript bridge fixture validates Android hardware.
test('native adapter audit queue survives SQLite export/reopen without changing business documents', async () => {
    const SQL = await initSqlJs();
    let sql = new SQL.Database();
    sql.run('create table documents(collection_name text,doc_id text,data text,sort_order integer,updatedAt text,primary key(collection_name,doc_id))');
    sql.run("insert into documents values('transactions','sale','{\"id\":\"sale\",\"total\":118}',0,'fixture')");
    const bridge = () => ({
        query: async (statement: string, values: any[] = []) => { const prepared = sql.prepare(statement); try { prepared.bind(values); const rows=[]; while(prepared.step())rows.push(prepared.getAsObject()); return {values:rows}; } finally { prepared.free(); } },
        executeSet: async (entries: Array<{statement: string; values: any[]}>) => { sql.run('begin immediate');try{for(const entry of entries)sql.run(entry.statement,entry.values);sql.run('commit');}catch(error){sql.run('rollback');throw error;}return {changes:{changes:entries.length}}; },
    });
    const first = new CapacitorSQLiteAdapter(); Object.assign(first,{db:bridge()});
    const entry = {id:'native-audit',timestamp:'2026-11-17T16:00:00Z',actionType:'POS_DISCOUNT',cashierId:'cashier',supervisorId:'supervisor',terminalId:'POS-1',hash:'',auditSyncVersion:1} as any;
    assert.equal(await persistAuthorizationLog(first,{} as any,entry),null);
    const bytes=sql.export();sql.close();sql=new SQL.Database(bytes);
    const reopened=new CapacitorSQLiteAdapter();Object.assign(reopened,{db:bridge()});
    assert.deepEqual(await reopened.getDocument('posAuditEvents',entry.id),authorizationQueueItem(entry));
    assert.deepEqual(await reopened.getDocument('transactions','sale'),{id:'sale',total:118});
    sql.close();
});
