import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SYNC_MONITOR_PAGE_SQL, syncMonitorPageParams, decodeSyncMonitorPage, type SyncMonitorPageRequest } from '../services/db/SyncMonitorPage';

function fixture() {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE documents(collection_name TEXT, doc_id TEXT, data TEXT, PRIMARY KEY(collection_name,doc_id))');
    const insert = db.prepare('INSERT INTO documents VALUES(?,?,?)');
    const add = (collection: string, document: any) => insert.run(collection, document.id, JSON.stringify(document));
    const page = (request: Partial<SyncMonitorPageRequest> = {}) => decodeSyncMonitorPage(db.prepare(SYNC_MONITOR_PAGE_SQL).get(...syncMonitorPageParams({ page: 1, pageSize: 10, search: '', status: 'ALL', terminal: 'ALL', ...request })));
    return { db, add, page };
}

test('native pagination transfers ten documents, keeps totals and finds old blocked records', () => {
    const { db, add, page } = fixture();
    try {
        for (let i = 0; i < 500; i++) add('transactions', { id: `t${i}`, date: new Date(1700000000000 + i * 1000).toISOString(), terminalId: 'T1', syncStatus: i < 2 ? 'BLOCKED_FUNCTIONAL' : 'COMPLETED', items: [{ description: 'x'.repeat(4000) }] });
        const first = page(), second = page({ page: 2 });
        assert.equal(first.total, 500);
        assert.equal(first.blocked, 2);
        assert.equal(first.collections.transactions.length, 10);
        assert.equal(second.collections.transactions.length, 10);
        const ids = new Set(first.collections.transactions.map(d => d.id));
        assert.ok(second.collections.transactions.every(d => !ids.has(d.id)));
        assert.equal(page({ status: 'ERROR' }).collections.transactions.length, 2);
        assert.equal(page({ search: "' OR 1=1 --" }).total, 0);
        assert.equal(page({ terminal: 'other' }).total, 0);
    } finally { db.close(); }
});

test('inventory groups stay complete and linked sale movements are not counted twice', () => {
    const { db, add, page } = fixture();
    try {
        add('transactions', { id: 'sale-1', displayId: 'F001', date: '2026-01-01', syncStatus: 'COMPLETED' });
        add('inventoryLedger', { id: 'F001:line1', createdAt: '2026-01-04', syncStatus: 'COMPLETED' });
        add('inventoryLedger', { id: 'sale-line', concept: 'VENTA', createdAt: '2026-01-04' });
        for (let i = 0; i < 12; i++) add('inventoryLedger', { id: `adjust-${i}`, documentRef: 'ADJUSTMENT', terminalId: 'T1', createdAt: '2026-01-03', syncStatus: i ? 'COMPLETED' : 'ERROR' });
        add('zReports', { id: 'z1', sequenceNumber: 'ZS001', closedAt: '2026-01-02', syncStatus: 'PENDING' });
        const first = page({ pageSize: 1 });
        assert.equal(first.total, 3);
        assert.equal(first.blocked, 1);
        assert.equal(first.collections.inventoryLedger.length, 12);
        assert.equal(page({ pageSize: 1, page: 2 }).collections.zReports[0].id, 'z1');
        assert.equal(page({ status: 'ERROR', search: 'ADJUST' }).total, 1);
    } finally { db.close(); }
});

test('all operational collections participate in filtering and the blocked count is global', () => {
    const { db, add, page } = fixture();
    try {
        for (const c of ['zReports','cashMovements','customerMutations','posUserMutations','wallet_transactions','loyalty_events']) add(c, { id: c, sequenceNumber: `DOC-${c}`, syncStatus: 'FAILED_FINAL', terminalId: 'T2', createdAt: '2026-01-01' });
        add('reservations', { id: 'r1', code: 'R-1', syncStatus: 'PENDING', createdAt: '2026-01-02' });
        assert.equal(page().total, 7);
        const filtered = page({ search: 'DOC-zReports', status: 'ERROR', terminal: 'T2' });
        assert.equal(filtered.total, 1);
        assert.equal(filtered.blocked, 6);
        assert.equal(filtered.collections.zReports[0].id, 'zReports');
        assert.equal(page({ status: 'PENDING' }).total, 1);
    } finally { db.close(); }
});

test('sorting accepts timestamps and timezone offsets without repeating page entries', () => {
    const { db, add, page } = fixture();
    try {
        add('transactions', { id: 'old', date: '2026-01-01T01:00:00+02:00' });
        add('transactions', { id: 'recent', date: Date.parse('2026-01-01T00:00:00Z') });
        assert.equal(page({ pageSize: 1 }).collections.transactions[0].id, 'recent');
        assert.equal(page({ pageSize: 1, page: 2 }).collections.transactions[0].id, 'old');
    } finally { db.close(); }
});
