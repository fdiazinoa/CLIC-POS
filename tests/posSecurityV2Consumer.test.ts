import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
import { recoveryDatabase } from '../services/recovery/RecoveryDatabase';
import type { RoleDefinition, User } from '../types';
import { PosSecurityV2Consumer, readPosSecurityRecords, type PosSecurityV2Transport } from '../services/sync/PosSecurityV2Consumer';
import { canonicalSecurityJSON, POS_SECURITY_V2_DIGEST, POS_SECURITY_V2_MODE, securityAnnouncement, securityHash, securityPartition, type SecurityBinding, type SecurityControl, type SecurityReference } from '../services/sync/PosSecurityV2Contract';
import { canAuthorizeReturn, canCompleteReturnApproval, hasReturnRequestContext, readReturnSecurityContext } from '../services/sync/PosSecurityV2Runtime';
import { requiresTerminalPolicyPin } from '../utils/terminalAuthorizationPolicy';

const B: SecurityBinding = { tenantId: 'tenant-a', terminalId: 'terminal-a', deviceId: 'device-a', bindingEpoch: 1 };
const offer = (binding = B, agreementId = 'agreement-a') => ({ ...securityAnnouncement(binding), offerId: 'offer-' + agreementId, agreementId, expiresAt: 301000 });
const control = (status: SecurityControl['negotiation']['status'] = 'ACTIVE', stateRevision = 3, binding = B, agreementId = 'agreement-a', floor: 0 | 2 = status === 'ACTIVE' || status === 'SUSPENDED' ? 2 : 0): SecurityControl => ({ status: 'success', negotiation: { status, stateRevision, protocolFloor: floor, binding, offer: offer(binding, agreementId) },
  selection: status === 'ACTIVE' ? { mode: 'V2', currentOperationsUnchanged: false, agreementId }
    : floor === 2 ? { mode: 'BLOCKED', currentOperationsUnchanged: false, reason: 'V2_REQUIRED' }
      : { mode: 'CURRENT_UNCHANGED', currentOperationsUnchanged: true, reason: status === 'ACCEPTED' ? 'WAIT_ACTIVATION' : 'WAIT_NEGOTIATION' } });
const role = (permissions = ['POS_RETURNS', 'custom_exact']) => ({ id: 'R', permissions, permission_keys: [...permissions], permissionContractVersion: 2, version: 4, maxDiscountPercent: 7.5, zReportConfig: { hiddenModules: ['AUDIT'] } });
const users = () => [{ id: 'cashier', role_id: 'R', pin: '1234' }, { id: 'supervisor', role_id: 'R', pin: '5678' }];
async function envelope(revision = 0, roles: unknown[] = [role()], members: unknown[] = users(), binding = B, agreementId = 'agreement-a') {
  const block = { ...securityAnnouncement(binding), agreementId, securityRevision: revision, roles, users: members };
  return { pos_security: { ...block, contentHash: await securityHash(block) } };
}
function reference(data: Awaited<ReturnType<typeof envelope>>): SecurityReference {
  const p = data.pos_security; return { binding: p.binding, agreementId: p.agreementId, contractDigest: p.contractDigest, permissionContractVersion: 2, securityRevision: p.securityRevision, contentHash: p.contentHash };
}
async function setup() {
  Object.assign(globalThis, { window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }), indexedDB: new IDBFactory(), IDBKeyRange, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  const raw = new IndexedDBAdapter(); await raw.connect();
  const adapter = recoveryDatabase(raw, () => false);
  const fixture = { binding: structuredClone(B), response: control(), data: await envelope(), calls: [] as unknown[] };
  const transport: PosSecurityV2Transport = {
    authorizedBinding: async () => structuredClone(fixture.binding),
    offer: async body => { fixture.calls.push(body); return fixture.response; },
    accept: async body => { fixture.calls.push(body); return fixture.response; },
    state: async () => fixture.response, capability: async body => { fixture.calls.push(body); return fixture.response; },
    currentReference: async () => reference(fixture.data),
    download: async (ref, partition) => { fixture.calls.push([ref, partition]); return fixture.data; },
  };
  return { raw, adapter, fixture, transport, consumer: new PosSecurityV2Consumer(adapter, transport) };
}

test('canonical JSON matches the fixed ERP handoff SHA256 vector', async () => {
  const binding = { tenantId: '00000000-0000-4000-8000-000000000001', terminalId: '00000000-0000-4000-8000-000000000002', deviceId: 'POS-EXAMPLE', bindingEpoch: 3 };
  const block = { ...securityAnnouncement(binding), agreementId: 'agreement-example-1', securityRevision: 7,
    roles: [{ id: 'ROLE_EXAMPLE', permissions: ['POS_RETURNS', 'POS_CUSTOM'], version: 4, maxDiscountPercent: 7, zReportConfig: { hiddenModules: ['AUDIT'] }, permission_keys: ['POS_RETURNS', 'POS_CUSTOM'], permissionContractVersion: 2 }], users: [{ id: 'operator-example', role_id: 'ROLE_EXAMPLE' }] };
  assert.equal(await securityHash(block), '039b2ffc72366843bfb6f8fd848eefc143415aca4a8500a4476ded6bbb8e585b');
  assert.equal(canonicalSecurityJSON({ b: [false, null, 7], a: 'x' }), '{"a":"x","b":[false,null,7]}');
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), Array(1), [undefined]]) assert.throws(() => canonicalSecurityJSON(value));
});

test('explicit announcement/acceptance keep CURRENT unchanged and never activate', async () => {
  const s = await setup(); try {
    await s.adapter.saveCollection('roles', [{ id: 'OLD', permissions: ['CAN_REFUND'] }]);
    s.fixture.response = control('OFFERED', 1); await s.consumer.announce();
    assert.deepEqual(s.fixture.calls[0], securityAnnouncement(B));
    s.fixture.response = control('ACCEPTED', 2); const accepted = await s.consumer.accept();
    assert.deepEqual(s.fixture.calls[1], { offerId: offer().offerId, ...securityAnnouncement(B) });
    assert.equal(accepted.selection.mode, 'CURRENT_UNCHANGED');
    assert.equal((await readPosSecurityRecords(s.adapter))[0].protocolFloor, 0);
    assert.equal((await s.adapter.getCollection<{ id: string }>('roles'))[0].id, 'OLD');
    await assert.rejects(s.consumer.applyCarrier(s.fixture.data), /NOT_ACTIVE/);
    for (const patch of [{ permissionContractVersion: '2' }, { permissionsMode: 'merge' }, { contractDigest: '0'.repeat(64) }]) {
      s.fixture.response = { ...control('OFFERED', 3), negotiation: { ...control('OFFERED', 3).negotiation, offer: { ...offer(), ...patch } } } as SecurityControl;
      await assert.rejects(s.consumer.refreshControl());
    }
  } finally { await s.raw.disconnect(); }
});

test('complete v2 snapshot persists exact permissions, revocation, empty catalogs and no inherited credentials', async () => {
  const s = await setup(); try {
    await s.adapter.saveCollection('users', [{ id: 'cashier', pin: 'OLD', name: 'Old' }]);
    await s.consumer.refreshControl();
    const data = await envelope(1, [role(), { id: 'ADMIN', permissions: ['ALL'], permission_keys: ['ALL'], permissionContractVersion: 2, isSystem: true }], [{ id: 'cashier', role_id: 'R' }], { bindingEpoch: 1, deviceId: B.deviceId, terminalId: B.terminalId, tenantId: B.tenantId });
    s.fixture.data = data; await s.consumer.applyCarrier(data);
    assert.deepEqual((await s.adapter.getCollection<RoleDefinition>('roles')).find(r => r.id === 'R')!.permissions, ['POS_RETURNS', 'custom_exact']);
    assert.equal((await s.adapter.getCollection<User>('users'))[0].pin, '');
    await s.raw.disconnect(); await s.raw.connect();
    let ctx = await readReturnSecurityContext(s.adapter, [], [], async () => B);
    assert.equal(canAuthorizeReturn(ctx, { id: 'cashier' } as User), true);
    assert.equal(ctx.roles.find(r => r.id === 'R')!.maxDiscountPercent, 7.5); assert.deepEqual(ctx.roles.find(r => r.id === 'R')!.zReportConfig, { hiddenModules: ['AUDIT'] });
    assert.deepEqual(ctx.roles.find(r => r.id === 'ADMIN')!.permissions, ['ALL']);
    s.fixture.data = await envelope(2, [role([])]); await s.consumer.applyCarrier(s.fixture.data);
    ctx = await readReturnSecurityContext(s.adapter, [], [], async () => B);
    assert.equal(canAuthorizeReturn(ctx, ctx.users[0]), false);
    s.fixture.data = await envelope(3, [], []); await s.consumer.applyCarrier(s.fixture.data);
    await s.raw.disconnect(); await s.raw.connect();
    assert.deepEqual(await s.adapter.getCollection('roles'), []); assert.deepEqual(await s.adapter.getCollection('users'), []);
    assert.equal((await readPosSecurityRecords(s.adapter))[0].protocolFloor, 2);
    assert.equal((await readReturnSecurityContext(s.adapter, [role() as unknown as RoleDefinition], users() as unknown as User[], async () => B)).users.length, 0);
    await assert.rejects(s.adapter.saveCollection('roles', [role()]), /LEGACY_WRITE_BLOCKED/);
  } finally { await s.raw.disconnect(); }
});

test('invalid full payloads reject without partial persistence or permission alias recovery', async () => {
  const s = await setup(); try {
    await s.consumer.refreshControl(); await s.consumer.applyCarrier(s.fixture.data);
    const before = await s.adapter.getCollection('roles'), state = await readPosSecurityRecords(s.adapter);
    const invalid = [
      await envelope(1, [{ ...role(), permissions: null }]), await envelope(1, [role(['CAN_REFUND'])]),
      await envelope(1, [{ ...role(), permission_keys: ['ALL'] }]), await envelope(1, [role(), { ...role(), id: 'r' }]),
      await envelope(1, [role()], [{ id: 'cashier', role_id: 'missing' }]), await envelope(1, [role()], [{ id: 'cashier', role_id: 'r' }]),
      await envelope(1, [{ ...role(), max_discount_percent: 99 }]), await envelope(1, [{ ...role(), zReportConfig: null }]),
    ];
    for (const data of invalid) { s.fixture.data = data; await assert.rejects(s.consumer.applyCarrier(data)); }
    for (const patch of [{ permissionContractVersion: '2' }, { permissionsMode: 'merge' }, { contentHash: '0'.repeat(64) }, { contractDigest: '0'.repeat(64) }, { binding: { ...B, deviceId: 'other' } }]) {
      const data = { pos_security: { ...(await envelope(1)).pos_security, ...patch } };
      await assert.rejects(s.consumer.applyCarrier(data));
    }
    assert.deepEqual(await s.adapter.getCollection('roles'), before); assert.deepEqual(await readPosSecurityRecords(s.adapter), state);
  } finally { await s.raw.disconnect(); }
});

test('references are partitioned, duplicate delivery is idempotent and stale/conflicting revisions do not fetch or apply', async () => {
  const s = await setup(); try {
    await s.consumer.refreshControl(); s.fixture.data = await envelope(7);
    assert.equal(await s.consumer.receiveConfigPush({ security_contract: reference(s.fixture.data) }), 'APPLIED');
    const key = await securityPartition(reference(s.fixture.data)); assert.equal((s.fixture.calls[0] as unknown[])[1], key);
    assert.equal(await s.consumer.receiveManifest({ security_contract: reference(s.fixture.data) }), 'DUPLICATE');
    const calls = s.fixture.calls.length;
    await assert.rejects(s.consumer.receiveReference({ ...reference(s.fixture.data), agreementId: 'other' }));
    await assert.rejects(s.consumer.receiveReference({ ...reference(s.fixture.data), binding: { ...B, tenantId: 'other' } }));
    assert.equal(s.fixture.calls.length, calls);
    s.fixture.data = await envelope(6); await assert.rejects(s.consumer.receiveReference(reference(s.fixture.data)), /REVISION_STALE/);
    s.fixture.data = await envelope(7, [role([])]); await assert.rejects(s.consumer.applyCarrier(s.fixture.data), /REVISION_STALE/);
    await assert.rejects(s.consumer.receiveConfigPush({ security_contract: reference(s.fixture.data), roles: [] }), /CARRIER_INVALID/);
    assert.equal((await s.adapter.getCollection<RoleDefinition>('roles'))[0].permissions.includes('POS_RETURNS'), true);
  } finally { await s.raw.disconnect(); }
});

test('supervisor and PIN resolution uses only canonical v2 grants and revalidates requester/context', async () => {
  const s = await setup(); try {
    const legacy = { id: 'legacy', roleId: 'stale', role: 'L' } as User;
    const current = await readReturnSecurityContext(s.adapter, [{ id: 'L', permissions: ['CAN_REFUND'] } as RoleDefinition]);
    assert.equal(canAuthorizeReturn(current, legacy), true);
    await s.consumer.refreshControl(); await s.consumer.applyCarrier(s.fixture.data);
    const start = await readReturnSecurityContext(s.adapter, [], [], async () => B);
    const requester = start.users[0], supervisor = start.users[1];
    assert.equal(canAuthorizeReturn(start, requester), true); assert.equal(canCompleteReturnApproval(start, start, supervisor, requester), true);
    const residual = { ...start, roles: [{ ...start.roles[0], permissions: ['CAN_REFUND'] as RoleDefinition['permissions'] }] };
    assert.equal(canAuthorizeReturn(residual, supervisor), false);
    assert.equal(canCompleteReturnApproval(start, { ...start, users: [supervisor] }, supervisor, requester), false);
    assert.equal(hasReturnRequestContext({ ...start, users: [] }, requester), false);
    assert.equal(requiresTerminalPolicyPin({ requireManagerForRefunds: true } as never, 'POS_RETURNS'), true);
    s.fixture.data = await envelope(1, [role([])]); await s.consumer.applyCarrier(s.fixture.data);
    const revoked = await readReturnSecurityContext(s.adapter, [], [], async () => B);
    assert.equal(canCompleteReturnApproval(start, revoked, supervisor, requester), false);
    assert.equal(canAuthorizeReturn(revoked, supervisor), false);
    assert.equal((await readReturnSecurityContext(s.adapter, [], [])).mode, 'BLOCKED', 'missing authenticated context never restores legacy after floor2');
  } finally { await s.raw.disconnect(); }
});

test('floor survives loss, rebind, rollback and metadata resets without restoring older roles', async () => {
  const s = await setup(); try {
    await s.consumer.refreshControl(); await s.consumer.applyCarrier(s.fixture.data);
    const saved = structuredClone((await readPosSecurityRecords(s.adapter))[0]);
    s.fixture.response = control('SUSPENDED', 4);
    let lookups = 0;
    const disconnected = new PosSecurityV2Consumer(s.adapter, { ...s.transport,
      capability: async () => { throw new Error('NETWORK_UNAVAILABLE'); },
      currentReference: async () => { lookups++; return reference(s.fixture.data); } });
    await assert.rejects(disconnected.reportLoss('ROLLBACK'), /NETWORK_UNAVAILABLE/);
    await assert.rejects(disconnected.receiveReference(reference(s.fixture.data)), /NOT_ACTIVE/);
    assert.equal(lookups, 0, 'local capability-loss fence rejects before reference lookup/download');
    await s.consumer.refreshControl();
    assert.equal((await readReturnSecurityContext(s.adapter, [], [], async () => B)).mode, 'BLOCKED');
    await s.adapter.saveCollection('syncMetadata', []);
    await s.raw.saveCollection('syncMetadata', [saved]); // another legacy metadata writer cannot restore old checkpoint content
    assert.equal((await readPosSecurityRecords(s.adapter))[0].control.negotiation.stateRevision, 4);
    await assert.rejects(s.adapter.deleteDocument('syncMetadata', saved.id), /STATE_WRITE_BLOCKED/);
    s.fixture.response = control('ACCEPTED', 5, B, 'agreement-b', 2); await s.consumer.refreshControl();
    assert.equal((await readPosSecurityRecords(s.adapter))[0].protocolFloor, 2);
    s.fixture.binding = { ...B, deviceId: 'device-b', bindingEpoch: 2 };
    s.fixture.response = control('ACTIVE', 6, s.fixture.binding, 'agreement-b'); await s.consumer.refreshControl();
    assert.equal((await readReturnSecurityContext(s.adapter, [], [], async () => s.fixture.binding)).mode, 'BLOCKED', 'old applied catalog cannot authorize a new binding/agreement');
    s.fixture.response = control('UNNEGOTIATED', 7, s.fixture.binding, 'agreement-b', 0); await assert.rejects(s.consumer.refreshControl(), /CONTROL_STALE/);
    await s.raw.disconnect(); await s.raw.connect(); assert.equal((await readPosSecurityRecords(s.adapter))[0].protocolFloor, 2);
  } finally { await s.raw.disconnect(); }
});

test('atomic checkpoint CAS rejects concurrent snapshots without partial roles/users publication', async () => {
  const s = await setup(); try {
    await s.consumer.refreshControl(); await s.consumer.applyCarrier(s.fixture.data);
    const first = await envelope(1, [role([])]), second = await envelope(2, [role(['ALL'])]);
    const a = new PosSecurityV2Consumer(s.adapter, { ...s.transport, currentReference: async () => reference(first) });
    const b = new PosSecurityV2Consumer(s.adapter, { ...s.transport, currentReference: async () => reference(second) });
    const outcomes = await Promise.allSettled([a.applyCarrier(first), b.applyCarrier(second)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const record = (await readPosSecurityRecords(s.adapter))[0];
    const actual = await s.adapter.getCollection<RoleDefinition>('roles');
    assert.deepEqual(actual[0].permissions, record.appliedReference!.securityRevision === 1 ? [] : ['ALL']);
    const corrupted = { ...record, checkpoints: {} }; await s.raw.saveDocumentsAtomically([{ collectionName: 'syncMetadata', document: corrupted }]);
    await assert.rejects(readPosSecurityRecords(s.adapter), /INVALID_JSON|PERSISTED_STATE_INVALID/);
    assert.equal((await readReturnSecurityContext(s.adapter, [], [], async () => B)).mode, 'BLOCKED');
  } finally { await s.raw.disconnect(); }
});
