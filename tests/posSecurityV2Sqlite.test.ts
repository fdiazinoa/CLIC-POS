import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { PosSecurityV2Consumer, readPosSecurityRecords, type PosSecurityV2Transport } from '../services/sync/PosSecurityV2Consumer';
import { readReturnSecurityContext } from '../services/sync/PosSecurityV2Runtime';
import { securityAnnouncement, securityHash, type SecurityControl, type SecurityReference } from '../services/sync/PosSecurityV2Contract';

// Real desktop SQLite, production adapter, simulated Capacitor connection. This is not Android evidence.
function open(file: string) {
  const db = new SQLite(file);
  const adapter = new CapacitorSQLiteAdapter();
  Object.assign(adapter, { db: {
    beginTransaction: async () => { db.exec('BEGIN IMMEDIATE'); },
    commitTransaction: async () => { db.exec('COMMIT'); },
    rollbackTransaction: async () => { db.exec('ROLLBACK'); },
    isTransactionActive: async () => ({ result: db.inTransaction }),
    query: async (sql: string, values: any[] = []) => ({ values: db.prepare(sql).all(...values) }),
    run: async (sql: string, values: any[] = []) => ({ changes: { changes: db.prepare(sql).run(...values).changes } }),
    execute: async (sql: string) => { db.exec(sql); return { changes: { changes: 0 } }; },
    executeSet: async (entries: { statement: string; values: any[] }[]) => { db.transaction(() => { for (const e of entries) db.prepare(e.statement).run(...e.values); })(); return { changes: { changes: entries.length } }; },
  } });
  return { db, adapter };
}
test('real file SQLite + production adapter: durable revocation/empties, reopen, CAS and rollback without partial publication', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'clic-security-v2-sqlite-')); const file = join(dir, 'security.sqlite');
  let store = open(file);
  t.after(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });
  Object.assign(globalThis, { window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }), localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  await (store.adapter as any).initSchema();
  const binding = { tenantId: 'sqlite-tenant', terminalId: 'sqlite-terminal', deviceId: 'sqlite-device', bindingEpoch: 1 };
  const control: SecurityControl = { status: 'success', negotiation: { status: 'ACTIVE', stateRevision: 3, protocolFloor: 2, binding,
    offer: { ...securityAnnouncement(binding), offerId: 'fixture-offer', agreementId: 'fixture-agreement', expiresAt: 300001 } },
    selection: { mode: 'V2', currentOperationsUnchanged: false, agreementId: 'fixture-agreement' } };
  const envelope = async (securityRevision: number, permissions: string[], empty = false) => {
    const block = { ...securityAnnouncement(binding), agreementId: 'fixture-agreement', securityRevision,
      roles: empty ? [] : [{ id: 'R', permissionContractVersion: 2, permissions, permission_keys: permissions }], users: empty ? [] : [{ id: 'u', role_id: 'R' }] };
    return { pos_security: { ...block, contentHash: await securityHash(block) } };
  };
  let data = await envelope(1, ['POS_RETURNS']);
  const reference = (): SecurityReference => { const b = data.pos_security; return { binding, agreementId: b.agreementId, contractDigest: b.contractDigest, permissionContractVersion: 2, securityRevision: b.securityRevision, contentHash: b.contentHash }; };
  const transport: PosSecurityV2Transport = { authorizedBinding: async () => binding, state: async () => control,
    currentReference: async () => reference(), download: async () => data, offer: async () => { throw Error('UNEXPECTED_NEGOTIATION'); }, accept: async () => { throw Error('UNEXPECTED_NEGOTIATION'); }, capability: async () => { throw Error('SYNTHETIC_OFFLINE'); } };
  let consumer = new PosSecurityV2Consumer(store.adapter, transport);
  await consumer.refreshControl(); await consumer.applyCarrier(data);
  data = await envelope(2, []); await consumer.applyCarrier(data);
  store.db.close(); store = open(file); consumer = new PosSecurityV2Consumer(store.adapter, transport);
  assert.deepEqual((await store.adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, []);
  const before = await readPosSecurityRecords(store.adapter);
  store.db.exec("CREATE TRIGGER synthetic_security_failure BEFORE INSERT ON documents WHEN NEW.collection_name='users' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_STORAGE_FAILURE'); END");
  data = await envelope(3, ['ALL']); await assert.rejects(consumer.applyCarrier(data), /SYNTHETIC_STORAGE_FAILURE/);
  assert.deepEqual(await readPosSecurityRecords(store.adapter), before);
  assert.deepEqual((await store.adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, []);
  store.db.exec('DROP TRIGGER synthetic_security_failure');
  const outcomes = await Promise.allSettled([consumer.applyCarrier(data), consumer.applyCarrier(data)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await readPosSecurityRecords(store.adapter))[0].appliedReference!.securityRevision, 3);
  data = await envelope(4, [], true); await consumer.applyCarrier(data);
  await assert.rejects(consumer.reportLoss('ROLLBACK'), /SYNTHETIC_OFFLINE/);
  store.db.close(); store = open(file);
  assert.deepEqual(await store.adapter.getCollection('roles'), []); assert.deepEqual(await store.adapter.getCollection('users'), []);
  assert.equal((await readPosSecurityRecords(store.adapter))[0].protocolFloor, 2);
  assert.equal((await readReturnSecurityContext(store.adapter, [], [], async () => binding)).mode, 'BLOCKED');
});
