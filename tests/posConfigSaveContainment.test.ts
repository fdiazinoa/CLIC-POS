import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { persistTerminalAssignmentRepair } from '../services/identity/configRepairPersistence';
import { buildAuthorizationLog, persistAuthorizationLog, reconcileAuthorizationBackups } from '../services/audit/PosOperationalAudit';
import type { BusinessConfig, User } from '../types';

const user = (id: string): User => ({ id, name: `Usuario ${id}`, pin: 'DO_NOT_SEND', role: 'cashier', isActive: true } as User);
const log = () => buildAuthorizationLog(user('cashier'), user('supervisor'), { permission: 'POS_DISCOUNT', actionDescription: 'Autorizar descuento', context: { ticketId: 'T-1', newValue: 10 } }, 'POS-1');
const baseConfig = { id: 'current', auditLogs: [] } as unknown as BusinessConfig & { id: string };

test('audit success writes only the durable queue item (no config replace)', async () => {
    const writes: Array<[string, any]> = [];
    const database: any = {
        saveDocument: async (collection: string, document: any) => { writes.push([collection, document]); },
        getDocument: async () => null,
        getCollection: async () => [],
    };
    const entry = log();
    assert.equal(await persistAuthorizationLog(database, baseConfig, entry), null);
    assert.deepEqual(writes.map(([collection]) => collection), ['posAuditEvents']);
    assert.equal(writes[0][1].syncStatus, 'PENDING');
    assert.equal(writes[0][1].event.id, entry.id);
});

test('audit storage failure retains a marked config backup and is not reported as success', async () => {
    const configWrites: any[] = [];
    const database: any = {
        saveDocument: async (collection: string, document: any) => {
            if (collection === 'posAuditEvents') throw new Error('native storage unavailable');
            configWrites.push(document);
        },
        getDocument: async () => null,
    };
    const warning = await persistAuthorizationLog(database, baseConfig, log());
    assert.ok(warning, 'a failed queue write must return a warning, never null');
    assert.equal(configWrites.length, 1);
    assert.equal(configWrites[0].auditLogs.at(-1).auditRecoveryPending, true);
});

test('recovery requeues a marked backup once with its durable receipt', async () => {
    const atomicWrites: any[][] = [];
    const stored = { ...baseConfig, auditLogs: [{ ...log(), auditRecoveryPending: true }] };
    const database: any = {
        getDocument: async (collection: string) => collection === 'config' ? stored : null,
        saveDocument: async () => undefined,
        saveDocumentsAtomically: async (rows: any[]) => { atomicWrites.push(rows); },
    };
    await reconcileAuthorizationBackups(database, 'POS-1');
    assert.equal(atomicWrites.length, 1);
    assert.ok(atomicWrites[0].some(row => row.collectionName === 'posAuditEvents'));
    assert.ok(atomicWrites[0].some(row => row.collectionName === 'syncMetadata'));
});

test('supervisor audit updates the in-memory mirror without persisting the whole config', async () => {
    const values = new Map<string, string>();
    const prior = new Map(['window', 'localStorage', 'indexedDB'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.defineProperties(globalThis, {
        window: { configurable: true, value: { setTimeout, clearTimeout, alert: () => undefined } },
        localStorage: { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } },
        indexedDB: { configurable: true, value: new IDBFactory() },
    });
    let database: any;
    try {
        const [{ useSupervisorAuth }, { dbAdapter }, { permissionService }] = await Promise.all([
            import('../hooks/useSupervisorAuth'), import('../services/db'), import('../services/sync/PermissionService'),
        ]);
        database = dbAdapter; await database.connect();
        const cashier = { id: 'cashier', name: 'Cajero', pin: '1234', role: 'cashier', roleId: 'cashier', isActive: true } as any;
        const supervisor = { id: 'supervisor', name: 'Supervisor', pin: '5678', role: 'supervisor', isActive: true } as any;
        const config = { id: 'current', terminals: [{ id: 'POS-1', config: {} }], auditLogs: [] } as unknown as BusinessConfig;
        permissionService.initialize(config as any, 'POS-1');
        let hook: ReturnType<typeof useSupervisorAuth>;
        let mirror = 0, persisted = 0;
        const roles = [{ id: 'cashier', name: 'Cashier', permissions: ['POS_DISCOUNT'], maxDiscountPercent: 20 }] as any;
        function Component() {
            hook = useSupervisorAuth({ config, currentUser: cashier, roles, onUpdateConfig: () => { persisted += 1; }, onAuditLogsMirror: () => { mirror += 1; } });
            return null;
        }
        renderToString(React.createElement(Component));
        const approved = hook!.requestApproval({ permission: 'POS_DISCOUNT', actionDescription: 'Descuento', context: { newValue: 10 } });
        await hook!.supervisorModalProps.onAuthorize(supervisor);
        assert.equal(await approved, true);
        assert.equal(mirror, 1, 'the audit mirror must update the in-memory config');
        assert.equal(persisted, 0, 'the supervisor audit must not persist the whole config');
        assert.equal((await database.getCollection('posAuditEvents')).length, 1, 'the durable event is still written');
    } finally {
        await database?.disconnect();
        for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
    }
});

test('identity repair skips unchanged config and retries against the ERP update after a CAS miss', async () => {
    const previous = { id: 'current', marker: 'before', terminals: [] } as unknown as BusinessConfig;
    const erp = { ...previous, marker: 'erp-newer' };
    let stored = previous;
    let writes = 0;
    const db = {
        getDocument: async <T>() => stored as T,
        saveConfigIfUnchanged: async (expected: BusinessConfig, next: BusinessConfig) => {
            if (++writes === 1) stored = erp;
            if (stored !== expected) return false;
            stored = next;
            return true;
        },
    };
    assert.equal(await persistTerminalAssignmentRepair(db,
        config => ({ config, changed: false, preferredTerminalId: null })), null);
    assert.equal(writes, 0);

    const result = await persistTerminalAssignmentRepair(db, config => ({
        config: { ...config, terminals: [{ id: 'only' }] } as BusinessConfig, changed: true, preferredTerminalId: 'only',
    }));
    assert.equal(writes, 2);
    assert.equal(stored, result);
    assert.equal((result as unknown as { marker: string }).marker, 'erp-newer');
    assert.deepEqual(result?.terminals, [{ id: 'only' }]);
});

test('SQLite CAS keeps a concurrent config update and writes the repaired canonical row only', async () => {
    const { nativeFixture } = await import('./articleFormatsNativeFixture');
    const fixture = await nativeFixture();
    try {
        const before = (await fixture.adapter.getDocument<BusinessConfig>('config', 'current'))!;
        const erp = { ...before, marker: 'erp-newer' };
        fixture.db.prepare("UPDATE documents SET data=? WHERE collection_name='config' AND doc_id='current'").run(JSON.stringify(erp));
        fixture.db.exec(`INSERT INTO documents VALUES ('config','other','{"id":"other"}',1,'fixture')`);
        assert.equal(await fixture.adapter.saveConfigIfUnchanged(before, { ...before, terminals: [] }), false);
        assert.deepEqual(await fixture.adapter.getDocument('config', 'current'), erp);
        assert.equal(await fixture.adapter.saveConfigIfUnchanged(erp, { ...erp, terminals: [] }), true);
        assert.deepEqual(await fixture.adapter.getDocument('config', 'current'), { ...erp, terminals: [] });
        assert.deepEqual(await fixture.adapter.getDocument('config', 'other'), { id: 'other' });
    } finally {
        fixture.db.close();
    }
});

test('IndexedDB CAS updates only the config seen by the caller', async () => {
    const prior = new Map(['indexedDB', 'window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const storage = new Map<string, string>();
    Object.defineProperties(globalThis, {
        indexedDB: { configurable: true, value: new IDBFactory() },
        window: { configurable: true, value: { setTimeout, clearTimeout } },
        localStorage: { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } },
    });
    const { IndexedDBAdapter } = await import('../services/db/adapters/IndexedDBAdapter');
    const adapter = new IndexedDBAdapter();
    try {
        await adapter.connect();
        const initial = { id: 'current', terminals: [] } as unknown as BusinessConfig & { id: string };
        const erp = { ...initial, publication: 'newer' };
        await adapter.saveDocument('config', initial);
        const read = (await adapter.getDocument<BusinessConfig>('config', 'current'))!;
        await adapter.saveDocument('config', erp);
        assert.equal(await adapter.saveConfigIfUnchanged(read, { ...read, terminals: [] }), false);
        assert.deepEqual(await adapter.getDocument('config', 'current'), erp);
        const repaired = { ...erp, terminals: [{ id: 'terminal' }] } as BusinessConfig;
        assert.equal(await adapter.saveConfigIfUnchanged(erp, repaired), true);
        assert.deepEqual(await adapter.getDocument('config', 'current'), repaired);
    } finally {
        await adapter.disconnect();
        for (const [key, descriptor] of prior) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
