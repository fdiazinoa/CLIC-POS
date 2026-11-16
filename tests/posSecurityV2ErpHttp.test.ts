import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
import { PosSecurityV2Sync } from '../services/sync/PosSecurityV2Sync';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import express from 'express';
import { AuthenticatedPosSecurityV2Transport } from '../services/sync/PosSecurityV2Transport';
import { securityAnnouncement } from '../services/sync/PosSecurityV2Contract';

// Opt in with an unmodified export of ERP 210102cd. This imports original modules, never copies handlers.
const source = process.env.CLIC_SECURITY_V2_ERP_SOURCE ? realpathSync(process.env.CLIC_SECURITY_V2_ERP_SOURCE) : undefined;
test('original ERP control router/service/auth over loopback HTTP, with synthetic RPC storage only', { skip: !source }, async t => {
  // Pin the transport boundary we exercise; no remote terminal credentials are read.
  const pinned = {
    'server/routes/posPermissionSecurityContract.js': 'f044a1918eb52e14f59b73048c34e3516197bad035aa59913d81a9af1fe9b044',
    'server/routes/setup.js': '771a0609662fac2a5f49367ae65a57e92cfb16eec82392d58fc9b89d9cc9f983',
    'server/services/posPermissionSecurityDelivery.js': 'fa02386515e0445977c2f53427736491863c9ed8f7dd6b376ec08abc66c04af7',
    'server/services/posPermissionClientAgreement.js': 'd0893e94b446425285c6e67f9a8214292102d38c04342e6833abc9f8512007e4',
    'server/services/posReturnPermissionContract.js': '7bbe5aef73c296d197608ef61f0d476636fab2ab83573605fef5b292aeab124b',
    'server/services/terminalOperationalAuth.js': 'aab49ac7834791c998c01637cbd5beb78d7e18fc409d45b33400164a580c3b32',
    'server/services/bindingEvidenceAuth.js': '5412beb4c2ae5453ad9ab2311a06e3bdcc6a4c6f7933de6d27309269d182342c',
  };
  for (const [path, expected] of Object.entries(pinned)) {
    assert.equal(createHash('sha256').update(await readFile(`${source}/${path}`)).digest('hex'), expected, path);
  }
  const load = (path: string) => import(pathToFileURL(`${source}/${path}`).href);
  const { createPosPermissionSecurityRouter } = await load('server/routes/posPermissionSecurityContract.js');
  const { createPosPermissionSecurityService, authorizePosSecurityCurrentTerminal, applyPosSecurityCarrier } = await load('server/services/posPermissionSecurityDelivery.js');
  const { createPosPermissionClientState, activatePosPermissionClientAgreement } = await load('server/services/posPermissionClientAgreement.js');
  const binding = { tenantId: 'tenant-fixture', terminalId: 'terminal-fixture', deviceId: 'device-fixture', bindingEpoch: 4 };
  const terminal = { id: binding.terminalId, tenant_id: binding.tenantId, device_id: binding.deviceId, authorized_device_id: binding.deviceId, store_id: 'store-fixture', config: { runtime: { syncAuthToken: 'fixture-only-token' } } };
  let context = { binding, state: createPosPermissionClientState(binding), source: { roles: [{ id: 'R', permissions: ['POS_RETURNS'], version: 1 }], users: [{ id: 'u', role_id: 'R' }] }, sourceRevision: 1, sourceFingerprint: 'fixture', checkpoint: null as unknown };
  let cas = 0;
  const client = {
    from: (table: string) => {
      const rows: Record<string, unknown> = { erp_terminals: terminal, erp_stores: { id: 'store-fixture', tenant_id: binding.tenantId, company_id: 'company-fixture' }, erp_companies: { id: 'company-fixture', tenant_id: binding.tenantId }, erp_tenants: { id: binding.tenantId, name: 'Synthetic Tenant', config: {} } };
      let terminalId = terminal.id;
      const result = () => ({ data: table === 'erp_terminals' && terminalId !== terminal.id ? null : rows[table] || null, error: null });
      const query = { select: () => query, eq: (key: string, id: string) => { if (table === 'erp_terminals' && key === 'id') terminalId = id; return query; }, single: async () => result(), maybeSingle: async () => result(), insert: async () => ({ error: null }) }; return query;
    },
    schema: (_schema: string) => ({ from: (_table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    rpc: async (name: string, args: any) => {
      if (name === 'erp_pos_security_peek') return { data: { status: 'PRESENT', binding, state: context.state }, error: null };
      if (name === 'erp_pos_security_cas') { assert.equal(args.p_expected_state_revision, context.state.stateRevision); cas++; context = { ...context, state: args.p_state }; }
      if (name === 'erp_pos_security_checkpoint') context.checkpoint = { reference: args.p_reference };
      return { data: structuredClone(context), error: null };
    },
  };
  const service = createPosPermissionSecurityService({ client, now: () => 10, uuid: () => 'synthetic-id' });
  const app = express(); app.use(express.json());
  app.use('/api/sync', createPosPermissionSecurityRouter({ client, service,
    authorizeTerminal: (req: any) => authorizePosSecurityCurrentTerminal(req, { client, terminalId: req.params.terminalId }) }));
  // Carrier endpoints below are fixture HTTP wrappers around the original delivery/envelope service.
  // Full setup/syncInbox handlers are not asserted by this test.
  for (const suffix of ['manifest', 'config', 'config-snapshots/fixture']) app.get(`/api/sync/terminals/:terminalId/${suffix}`, async (req, res) => {
    try {
      const authorized = await authorizePosSecurityCurrentTerminal(req, { client, terminalId: req.params.terminalId });
      const delivery = await service.delivery(authorized);
      res.json(suffix === 'manifest' ? { manifest: { security_contract: delivery.reference } }
        : suffix.startsWith('config-snapshots') ? { domains: { catalog: applyPosSecurityCarrier({}, delivery) } }
          : { terminal_config: applyPosSecurityCarrier({}, delivery) });
    } catch (error: any) { res.status(error.status || 503).json({ code: error.code }); }
  });
  // Mount the original setup router, mocking unrelated catalog/company data ports only.
  const setupSource = await readFile(`${source}/server/routes/setup.js`, 'utf8');
  const mocks = new Map<string, string>();
  const values: Record<string, unknown> = {
    client, SETUP_TERMINAL_COLUMNS: '*',
    getTenantState: () => ({ mode: 'ACTIVE_POS_ERP' }),
    findSetupTerminalByReference: async () => ({ data: terminal, error: null }),
    isSetupTerminalUuid: () => true,
    getDeviceBinding: () => binding.deviceId, getAuthorizedDeviceId: () => binding.deviceId,
    hasRealDeviceBinding: () => true,
    buildInitialConfigVersion: () => 'fixture-config-version', normalizeInitialConfigVersion: (v: unknown) => String(v || ''),
    buildSetupTerminalResponse: () => ({}),
    buildTerminalConfigSnapshot: async (_t: unknown, _s: unknown, _c: unknown, _n: unknown, options: any) => applyPosSecurityCarrier({ masters: { items: [] } }, options.securityDelivery),
  };
  (globalThis as any).__posSecurityErpFixture = values;
  for (const match of setupSource.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g)) {
    const [, names, specifier] = match;
    if (specifier === 'express' || specifier.endsWith('/posPermissionSecurityDelivery.js')) continue;
    const exports = names.trim().startsWith('{') ? names.replace(/[{}]/g, '').split(',').map(name => name.trim()).filter(Boolean) : ['default'];
    const code = exports.map(name => name === 'default' ? 'export default globalThis.__posSecurityErpFixture.client;'
      : `export const ${name} = globalThis.__posSecurityErpFixture[${JSON.stringify(name)}] ?? (() => undefined);`).join('\n');
    mocks.set(specifier, code);
  }
  const hook = registerHooks({
    resolve(specifier, ctx, next) {
      if (ctx.parentURL === pathToFileURL(`${source}/server/routes/setup.js`).href && mocks.has(specifier)) return { url: `security-qa:${specifier}`, shortCircuit: true };
      return next(specifier, ctx);
    },
    load(url, ctx, next) {
      if (url.startsWith('security-qa:')) return { format: 'module', source: mocks.get(url.slice('security-qa:'.length))!, shortCircuit: true };
      return next(url, ctx);
    },
  });
  try { app.use('/api/setup', (await load('server/routes/setup.js')).default); }
  finally { hook.deregister(); }
  t.after(() => { delete (globalThis as any).__posSecurityErpFixture; });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const identity = { ...binding, erpSyncBaseUrl: `${base}/api/sync`, syncToken: 'fixture-only-token' };
  const transport = new AuthenticatedPosSecurityV2Transport(() => identity);
  assert.deepEqual(await transport.authorizedBinding(), binding);
  const offered: any = await transport.offer(securityAnnouncement(binding));
  assert.equal(offered.negotiation.status, 'OFFERED');
  const acceptance = { ...securityAnnouncement(binding), offerId: offered.negotiation.offer.offerId };
  const accepted: any = await transport.accept(acceptance);
  const repeated: any = await transport.accept(acceptance);
  assert.deepEqual(repeated, accepted); assert.equal(accepted.selection.reason, 'WAIT_ACTIVATION');
  assert.equal(accepted.negotiation.protocolFloor, 0);
  const before = cas; await transport.state(); await transport.state(); assert.equal(cas, before);
  for (const key of ['tenantId', 'terminalId', 'deviceId'] as const) {
    await assert.rejects(transport.accept({ ...acceptance, binding: { ...binding, [key]: 'foreign' } }), /BINDING_MISMATCH/);
  }
  for (const token of ['', 'invalid']) {
    const response = await fetch(`${base}/api/sync/terminals/${binding.terminalId}/security-contract`, { headers: { 'X-Sync-Token': token, 'X-Device-Id': binding.deviceId } });
    assert.equal(response.status, 401);
  }
  assert.equal((await fetch(`${base}/api/sync/terminals/${binding.terminalId}/security-contract`, { headers: { 'X-Sync-Token': identity.syncToken, 'X-Device-Id': 'foreign' } })).status, 403);
  // Synthetic server-only approval; no request route accepts activation or verification fields.
  context.state = activatePosPermissionClientAgreement(context.state, { authorizedBinding: binding, rolloutApproved: true, consumerAcceptanceVerificationId: 'synthetic-test-only', verificationBinding: binding, verificationAgreementId: accepted.negotiation.offer.agreementId, verificationContractDigest: accepted.negotiation.offer.contractDigest, nowMs: 11 });
  assert.equal((await transport.state()).negotiation.status, 'ACTIVE');
  const initialResponse = await fetch(`${base}/api/setup/initial-config/${binding.terminalId}`, { headers: { 'X-Sync-Token': identity.syncToken, 'X-Device-Id': binding.deviceId, 'If-None-Match': '"fixture-config-version"' } });
  assert.equal(initialResponse.status, 200);
  const initial: any = await initialResponse.json();
  assert.deepEqual(initial.terminal_config.pos_security.roles[0].permissions, ['POS_RETURNS']);
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange, window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }), localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const adapter = new IndexedDBAdapter(); await adapter.connect(); t.after(() => adapter.disconnect());
  const sync = new PosSecurityV2Sync(adapter, transport);
  assert.equal(await sync.receive(initial, 'initial-config'), 'APPLIED');
  assert.deepEqual((await adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, ['POS_RETURNS']);

  assert.equal((await fetch(`${base}/api/setup/initial-config/${binding.terminalId}`, { headers: { 'X-Sync-Token': 'invalid', 'X-Device-Id': binding.deviceId } })).status, 500); // Original setup maps this auth error to 500; still denies.

  const ref: any = await transport.currentReference();
  const { securityPartition } = await import('../services/sync/PosSecurityV2Contract');
  const block: any = await transport.download(ref, await securityPartition(ref));
  assert.deepEqual(block.pos_security.roles[0].permissions, ['POS_RETURNS']);
  context.source.roles = []; context.source.users = []; context.sourceRevision++;
  const manifest = await (await fetch(`${base}/api/sync/terminals/${binding.terminalId}/manifest`, { headers: { 'X-Sync-Token': identity.syncToken, 'X-Device-Id': binding.deviceId } })).json();
  assert.equal(await sync.receive(manifest, 'manifest'), 'APPLIED');
  assert.deepEqual(await adapter.getCollection('roles'), []); assert.deepEqual(await adapter.getCollection('users'), []);

  assert.equal((await fetch(`${base}/api/sync/terminals/${binding.terminalId}/security-contract/activate`, { method: 'POST' })).status, 404);
  assert.equal((await transport.capability({ binding, agreementId: accepted.negotiation.offer.agreementId, available: false, reason: 'CAPABILITY_LOST' }) as any).selection.mode, 'BLOCKED');
});
