import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import SQLite from 'better-sqlite3';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { retryDatabaseStartup } from '../services/db/StartupRetry';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture(t: TestContext, schema?: () => Promise<void>, open?: () => Promise<void>) {
    t.mock.method(Capacitor, 'isNativePlatform', () => true);
    t.mock.method(Capacitor, 'getPlatform', () => 'android');
    const folder = mkdtempSync(join(tmpdir(), 'clic-sqlite-startup-'));
    const file = join(folder, 'existing.db');
    const seed = new SQLite(file);
    seed.exec('CREATE TABLE retained (id TEXT PRIMARY KEY, data TEXT)');
    seed.prepare('INSERT INTO retained VALUES (?, ?)').run('sale-496', JSON.stringify({ total: 517 }));
    seed.close();
    const calls = { managers: 0, checks: 0, opens: 0, schemas: 0, closes: 0 };
    let connection: ReturnType<typeof createHandle> | undefined;
    const createHandle = () => {
        let db: SQLite.Database | undefined;
        return {
            isDBOpen: async () => ({ result: Boolean(db?.open) }),
            isTransactionActive: async () => ({ result: Boolean(db?.inTransaction) }),
            rollbackTransaction: async () => { db!.exec('ROLLBACK'); },
            open: async () => {
                calls.opens++;
                await open?.();
                db = new SQLite(file);
            },
            execute: async (sql: string) => {
                calls.schemas++;
                // Emulate the native plugin holding a transaction during schema work.
                db!.exec('BEGIN');
                await schema?.();
                db!.exec(sql);
                db!.exec('COMMIT');
            },
            query: async (sql: string, params: unknown[] = []) => ({ values: db!.prepare(sql).all(...params) }),
            close: () => { db?.close(); },
        };
    };
    class Manager {
        constructor() { calls.managers++; }
        async checkConnectionsConsistency() { calls.checks++; return { result: false }; }
        async isConnection() { return { result: false }; }
        async createConnection() { connection = createHandle(); return connection; }
        async closeConnection() { calls.closes++; connection?.close(); connection = undefined; }
    }
    const adapter = new CapacitorSQLiteAdapter();
    Object.assign(adapter, {
        loadSQLiteBridge: async () => ({ CapacitorSQLite: {}, SQLiteConnection: Manager }),
        // Keep this lifecycle test independent of version-specific POS migrations.
        initSchema: async () => connection!.execute('CREATE TABLE IF NOT EXISTS startup_fixture (id TEXT PRIMARY KEY)'),
    });
    t.after(() => { connection?.close(); rmSync(folder, { recursive: true, force: true }); });
    return { adapter, calls, file };
}

test('simultaneous local and V3 startup callers share one open and schema transaction', async t => {
    const entered = deferred(), release = deferred();
    const { adapter, calls } = fixture(t, async () => { entered.resolve(); await release.promise; });
    const starts = Array.from({ length: 20 }, () => adapter.connect());
    await entered.promise;
    assert.deepEqual(calls, { managers: 1, checks: 1, opens: 1, schemas: 1, closes: 0 });
    release.resolve();
    await Promise.all(starts);
    await adapter.connect();
    assert.equal(calls.opens, 1);
});

test('a caller timeout and retry do not replace an unfinished native migration', async t => {
    const entered = deferred(), release = deferred();
    const { adapter, calls } = fixture(t, async () => { entered.resolve(); await release.promise; });
    const pending = adapter.connect();
    await entered.promise;
    await assert.rejects(Promise.race([pending, Promise.reject(new Error('TIMEOUT:DB_CONNECT'))]), /TIMEOUT/);
    const retry = adapter.connect();
    release.resolve();
    await Promise.all([pending, retry]);
    assert.equal(calls.managers, 1);
    assert.equal(calls.opens, 1);
});

test('failed schema work releases its transaction and retry preserves existing sales', async t => {
    let fail = true;
    const failure = new Error('schema migration failed');
    const { adapter, calls, file } = fixture(t, async () => { if (fail) throw failure; });
    await assert.rejects(adapter.connect(), error => error === failure);
    assert.equal(calls.closes, 1);
    // A separate writer proves the failed native transaction no longer holds a lock.
    const external = new SQLite(file);
    external.prepare('INSERT INTO retained VALUES (?, ?)').run('sale-after-failure', '{}');
    external.close();
    fail = false;
    await adapter.connect();
    const result = await adapter.executeSQL('SELECT id, data FROM retained ORDER BY id');
    assert.deepEqual(result[0].values, [['sale-496', '{"total":517}'], ['sale-after-failure', '{}']]);
    assert.equal(calls.opens, 2);
});

test('failed open releases its registration and a later retry can connect', async t => {
    let fail = true;
    const failure = new Error('Open: database is locked (code 5): PRAGMA journal_mode');
    const { adapter, calls } = fixture(t, undefined, async () => { if (fail) throw failure; });
    await assert.rejects(adapter.connect(), error => error === failure);
    assert.equal(calls.closes, 1);
    fail = false;
    await adapter.connect();
    assert.equal(calls.opens, 2);
});

test('disconnect waits for initialization and a concurrent reconnect waits for close', async t => {
    const entered = deferred(), release = deferred();
    const { adapter, calls } = fixture(t, async () => { entered.resolve(); await release.promise; });
    const pending = adapter.connect();
    await entered.promise;
    const stopping = adapter.disconnect();
    assert.equal(adapter.disconnect(), stopping);
    const restarting = adapter.connect();
    assert.equal(calls.closes, 0);
    release.resolve();
    await Promise.all([pending, stopping, restarting]);
    assert.equal(calls.closes, 1);
    assert.equal(calls.opens, 2);
    await adapter.disconnect();
    assert.equal(calls.closes, 2);
});

test('consistency errors are surfaced before attempting to create another connection', async t => {
    const { adapter, calls } = fixture(t);
    const failure = new Error('native consistency failed');
    Object.assign(adapter, { loadSQLiteBridge: async () => ({ CapacitorSQLite: {}, SQLiteConnection: class {
        async checkConnectionsConsistency() { throw failure; }
    } }) });
    await assert.rejects(adapter.connect(), error => error === failure);
    assert.equal(calls.opens, 0);
});

test('startup retry reloads only after native schema work and close finish', async t => {
    const entered = deferred(), release = deferred();
    const { adapter, calls } = fixture(t, async () => { entered.resolve(); await release.promise; });
    const pending = adapter.connect();
    await entered.promise;
    let reloads = 0;
    const retry = retryDatabaseStartup(adapter, () => { reloads++; assert.equal(calls.closes, 1); });
    await Promise.resolve();
    assert.equal(reloads, 0);
    release.resolve();
    await Promise.all([pending, retry]);
    assert.equal(reloads, 1);
});

test('startup retry never reloads if the native handle cannot close', async () => {
    const failure = new Error('native close failed');
    let reloaded = false;
    await assert.rejects(retryDatabaseStartup({ disconnect: async () => { throw failure; } },
        () => { reloaded = true; }), error => error === failure);
    assert.equal(reloaded, false);
});

test('cleanup failure retains the old manager until a later close succeeds', async t => {
    const entered = deferred(), release = deferred();
    let failSchema = true;
    const failure = new Error('migration failed');
    const { adapter, calls } = fixture(t, async () => {
        if (failSchema) { entered.resolve(); await release.promise; throw failure; }
    });
    const pending = adapter.connect();
    await entered.promise;
    const manager = (adapter as any).sqliteConnection;
    const close = manager.closeConnection.bind(manager);
    let failClose = true;
    t.mock.method(manager, 'closeConnection', async () => {
        if (failClose) { failClose = false; throw new Error('close failed'); }
        await close();
    });
    release.resolve();
    await assert.rejects(pending, error => error === failure);
    assert.equal((adapter as any).sqliteConnection, manager);
    failSchema = false;
    await adapter.connect();
    assert.equal(calls.closes, 1);
    assert.equal(calls.managers, 2);
});
