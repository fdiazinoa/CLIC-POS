import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import express from 'express';

// Original modules are hash checked and loaded verbatim. Only imported data/infra ports are replaced.
// One outer fixture per process: the original routers intentionally retain module-local caches.
const pins = {
  'server/services/terminalDeviceAuthorization.js': '463da0d03bf94dae7717c55669eb8bb4233e61a5c0c22bab8d6b6cd378621fa6',
  'server/services/terminalDeviceBinding.js': 'eb3b78be081ba7902d4f6320deadafe6042d74d982b6abde0cfccf3baadf7aee',
  'server/services/terminalLookupQuery.js': 'a7ae19361a02fcfb500bc0c8a8534de62ce01c1c3dd9e508ecb1c0976a402e6b',
  'server/services/configSnapshotDownloadCache.js': '861cdeef63dbcdf6601e1812cedfaa0ab15dcf22adcc1887b7b3328eede9b08a',
  'server/routes/syncInbox.js': 'c145f209205c81a0268e675c949e8b02afcb2f7f7ab719d514772d14a5adfcdb',
  'server/routes/posPermissionSecurityContract.js': 'f044a1918eb52e14f59b73048c34e3516197bad035aa59913d81a9af1fe9b044',
  'server/routes/setup.js': '771a0609662fac2a5f49367ae65a57e92cfb16eec82392d58fc9b89d9cc9f983',
  'server/services/posPermissionSecurityDelivery.js': 'fa02386515e0445977c2f53427736491863c9ed8f7dd6b376ec08abc66c04af7',
  'server/services/posPermissionClientAgreement.js': 'd0893e94b446425285c6e67f9a8214292102d38c04342e6833abc9f8512007e4',
  'server/services/posReturnPermissionContract.js': '7bbe5aef73c296d197608ef61f0d476636fab2ab83573605fef5b292aeab124b',
  'server/services/terminalOperationalAuth.js': 'aab49ac7834791c998c01637cbd5beb78d7e18fc409d45b33400164a580c3b32',
  'server/services/bindingEvidenceAuth.js': '5412beb4c2ae5453ad9ab2311a06e3bdcc6a4c6f7933de6d27309269d182342c',
};
export async function originalErpFixture(source: string) {
  for (const [file, hash] of Object.entries(pins)) assert.equal(createHash('sha256').update(await readFile(`${source}/${file}`)).digest('hex'), hash, file);
  const load = (path: string) => import(pathToFileURL(`${source}/${path}`).href);
  const deliveryModule = await load('server/services/posPermissionSecurityDelivery.js');
  const agreementModule = await load('server/services/posPermissionClientAgreement.js');
  const binding = { tenantId: '00000000-0000-4000-8000-000000000001', terminalId: '00000000-0000-4000-8000-000000000002', deviceId: 'synthetic-device', bindingEpoch: 4 };
  const otherTerminalId = '00000000-0000-4000-8000-000000000003';
  const token = 'synthetic-erp-token';
  const terminal = { sync_token_fingerprint: createHash('sha256').update(token).digest('hex'), id: binding.terminalId, tenant_id: binding.tenantId, device_id: binding.deviceId, authorized_device_id: binding.deviceId, store_id: 'store-fixture', config: { runtime: { syncAuthToken: token } } };
  const foreignTerminal = { ...terminal, id: otherTerminalId, tenant_id: 'foreign-tenant', device_id: 'foreign-device', authorized_device_id: 'foreign-device', sync_token_fingerprint: createHash('sha256').update('foreign-token').digest('hex'), config: { runtime: { syncAuthToken: 'foreign-token' } } };
  const store = { id: terminal.store_id, tenant_id: binding.tenantId, company_id: 'company-fixture' };
  const company = { id: store.company_id, tenant_id: binding.tenantId };
  const tenant = { id: binding.tenantId, name: 'Synthetic Tenant', config: {} };
  let context = { binding, state: agreementModule.createPosPermissionClientState(binding), source: { roles: [{ id: 'R', permissions: ['POS_RETURNS'], version: 1 }], users: [{ id: 'u', role_id: 'R' }] }, sourceRevision: 1, sourceFingerprint: 'fixture-1', checkpoint: null as any };
  const snapshots: any[] = [];
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  let cas = 0;
  const tables: Record<string, any[]> = { erp_terminals: [terminal, foreignTerminal], erp_stores: [store], erp_companies: [company], erp_tenants: [tenant], erp_sync_snapshots: snapshots, terminal_device_revocations: [] };
  const pathValue = (row: any, key: string) => key.replace(/->>/g, '.').replace(/->/g, '.').split('.').reduce((value, part) => value?.[part], row);
  function query(table: string, landlord = false) {
    const filters: [string, unknown][] = []; let mode: 'many' | 'one' = 'many', maximum = Infinity;
    const predicates: ((row: any) => boolean)[] = [];
    const evaluate = () => {
      reads.push({ table, filters: structuredClone(filters) });
      assert.ok(landlord || Object.hasOwn(tables, table), `Unexpected table ${table}`);
      const rows = (landlord ? [] : tables[table]).filter(row => predicates.every(p => p(row))).slice(0, maximum);
      return { data: structuredClone(mode === 'one' ? rows[0] || null : rows), error: null };
    };
    const q: any = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); predicates.push(row => pathValue(row, key) === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push([key, values]); predicates.push(row => values.includes(pathValue(row, key))); return q; },
      or: (expression: string) => {
        const parts = [...expression.matchAll(/([^,]+?)\.(eq|ilike)\."((?:\\.|[^"\\])*)"/g)];
        assert.ok(parts.length, `Unsupported OR filter ${expression}`);
        predicates.push(row => parts.some(([, key, op, escaped]) => {
          const expected = escaped.replace(/\\([\\"])/g, '$1'); const actual = pathValue(row, key);
          return op === 'eq' ? actual === expected : String(actual || '').toLowerCase() === expected.toLowerCase();
        })); return q;
      },
      limit: (value: number) => { maximum = value; return q; },
      maybeSingle: () => { mode = 'one'; return Promise.resolve(evaluate()); },
      single: () => { mode = 'one'; return Promise.resolve(evaluate()); },
      insert: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(evaluate).then(resolve, reject),
    }; return q;
  }
  const client = {
    from: (table: string) => query(table), schema: () => ({ from: (table: string) => query(table, true) }),
    rpc: async (name: string, args: any) => {
      if (name === 'erp_sync_record_snapshot_download') return { data: null, error: null };
      if (name === 'erp_pos_security_peek') { assert.equal(args.p_terminal_id, binding.terminalId); return { data: { status: 'PRESENT', binding, state: structuredClone(context.state) }, error: null }; }
      assert.equal(args.p_terminal_id, binding.terminalId); assert.equal(args.p_device_id, binding.deviceId);
      if (name === 'erp_pos_security_cas') { assert.equal(args.p_expected_state_revision, context.state.stateRevision); cas++; context = { ...context, state: args.p_state }; }
      else if (name === 'erp_pos_security_checkpoint') { assert.equal(args.p_expected_state_revision, context.state.stateRevision); assert.equal(args.p_expected_source_revision, context.sourceRevision); context.checkpoint = { reference: args.p_reference }; }
      else assert.equal(name, 'erp_pos_security_context');
      return { data: structuredClone(context), error: null };
    },
  };
  const service = deliveryModule.createPosPermissionSecurityService({ client });
  const dataSnapshot = async (_t: unknown, _s: unknown, _c: unknown, _n: unknown, options: any) => deliveryModule.applyPosSecurityCarrier({ masters: { items: [] } }, options.securityDelivery);
  const emptyRouter = () => express.Router();
  const values: Record<string, any> = {
    client, SETUP_TERMINAL_COLUMNS: '*',
    getTenantState: () => ({ mode: 'ACTIVE_POS_ERP' }), getCompanyById: async () => company, getLocalTenantById: async () => tenant,
    findSetupTerminalByReference: async () => ({ data: terminal, error: null }), isSetupTerminalUuid: () => true,
    buildTerminalTypeContract: () => ({}),
    buildInitialConfigVersion: () => 'fixture-config-version', normalizeInitialConfigVersion: (v: unknown) => String(v || ''), buildSetupTerminalResponse: () => ({}),
    buildTerminalConfigSnapshot: dataSnapshot, buildTerminalConfigManifest: () => ({ terminal_id: terminal.id, versions: {} }),
    buildTerminalConfigEndpointPayload: (snapshot: unknown) => ({ status: 'success', terminal_config: snapshot }),
    finalizeTerminalConfigForPosSync: async (snapshot: unknown) => ({ terminalConfig: snapshot }),
    listDescataloguedPosUserRemovals: async () => [], withDescataloguedPosUserRemovals: (snapshot: unknown) => snapshot,
    collectTerminalLookupHints: () => ({}), assertFreshZSequenceSnapshot: async () => {},
    onTerminalConfigInvalidated: () => {}, runOperationalContextShadow: () => {}, upsertTerminalDeviceRequest: async () => ({}),
    CLOUD_CHANNELS: { ERP_ACTIVE: 'ERP_ACTIVE', POS_CLOUD_STAGING: 'POS_CLOUD_STAGING' },
    ERP_SYNC_SNAPSHOT_KINDS: { MANIFEST: 'manifest', TERMINAL_CONFIG: 'terminal_config' },
    resolvePosCloudActivation: () => ({ cloud_channel: 'ERP_ACTIVE', permissions: { pull_masters: true } }),
    isPersistentSnapshotKindConsumeEnabled: () => false, isLargeMasterSyncV3Allowed: () => false,
    createInventoryPresentationIngress: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    createFiscalTerminalWrapper: () => () => {}, createFreshFiscalContextLoader: () => () => {},
    createCompanyDispatchNativeHandler: () => (_req: unknown, res: any) => res.sendStatus(404),
    createPosFiscalWorkflowService: () => ({}), createPosFiscalStatusService: () => ({}),
    createItemsMasterDataService: () => ({}), createBusinessPartnersMasterDataService: () => ({}),
    createOriginalCommercialService: () => ({}), createRefundSourceService: () => ({}), receivedNativeCloseOptions: () => ({}),
    createPosFiscalWorkflowRouter: emptyRouter, createPosFiscalStatusRouter: emptyRouter, createLargeMasterSyncV3Router: emptyRouter,
    createInventoryPresentationsRouter: emptyRouter, createArticleFormatsPosV2Router: emptyRouter, createArticleFormatsPosRouter: emptyRouter,
    createTerminalDeviceRequestsRouter: emptyRouter, createRefundSourcesRouter: emptyRouter, createCouponIssuanceRouter: emptyRouter, createOriginalRecoveryRouter: emptyRouter,
  };
  const originals = new Set(['express', 'node:crypto', './posPermissionSecurityContract.js', '../services/posPermissionSecurityDelivery.js', '../services/terminalOperationalAuth.js', '../services/bindingEvidenceAuth.js', '../services/terminalDeviceAuthorization.js', '../services/terminalDeviceBinding.js', '../services/terminalLookupQuery.js', '../services/configSnapshotDownloadCache.js']);
  const mocks = new Map<string, string>();
  const parentUrls = new Set<string>();
  for (const path of ['server/routes/setup.js', 'server/routes/syncInbox.js']) {
    parentUrls.add(pathToFileURL(`${source}/${path}`).href);
    const text = await readFile(`${source}/${path}`, 'utf8');
    for (const [, names, specifier] of text.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g)) {
      if (originals.has(specifier)) continue;
      const exports = names.trim().startsWith('{') ? names.replace(/[{}]/g, '').split(',').map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean) : ['default'];
      const existing = mocks.get(specifier) || '';
      const declarations = exports.filter(name => name === 'default' ? !existing.includes('export default ') : !existing.includes(`export const ${name} =`)).map(name => name === 'default' ? 'export default globalThis.__posSecurityOriginalErp.client;'
        : `export const ${name} = globalThis.__posSecurityOriginalErp[${JSON.stringify(name)}] ?? (() => { throw new Error('Unexpected ERP dependency: ${name}'); });`).join('\n');
      mocks.set(specifier, existing + '\n' + declarations);
    }
  }
  (globalThis as any).__posSecurityOriginalErp = values;
  const hook = registerHooks({
    resolve(specifier, ctx, next) {
      if (parentUrls.has(ctx.parentURL!) && mocks.has(specifier)) return { url: `security-original-qa:${specifier}`, shortCircuit: true };
      return next(specifier, ctx);
    },
    load(url, ctx, next) {
      if (url.startsWith('security-original-qa:')) return { format: 'module', source: mocks.get(url.slice('security-original-qa:'.length))!, shortCircuit: true };
      return next(url, ctx);
    },
  });
  const app = express(); app.use(express.json());
  try { app.use('/api/setup', (await load('server/routes/setup.js')).default); app.use('/api/sync', (await load('server/routes/syncInbox.js')).default); }
  finally { hook.deregister(); }
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function snapshot() {
    const delivery = await service.delivery(terminal);
    const id = `snapshot-${context.sourceRevision}`;
    snapshots.splice(0, snapshots.length,
      { id, tenant_id: binding.tenantId, terminal_id: terminal.id, snapshot_kind: 'manifest', version_hash: `transport-${context.sourceRevision}`, status: 'READY', payload: { config_push_reference: true, scopes: ['catalog'], versions: { catalog: context.sourceRevision }, security_contract: delivery.reference, domain_snapshots: { catalog: { snapshot_id: `catalog-${context.sourceRevision}`, version_hash: `catalog-hash-${context.sourceRevision}` } } } },
      { id: `catalog-${context.sourceRevision}`, tenant_id: binding.tenantId, terminal_id: terminal.id, snapshot_kind: 'catalog', version_hash: `catalog-hash-${context.sourceRevision}`, status: 'READY', payload: { pos_security: delivery.envelope.pos_security } },
      { id: 'foreign-snapshot', tenant_id: foreignTerminal.tenant_id, terminal_id: foreignTerminal.id, snapshot_kind: 'manifest', version_hash: 'foreign-transport', status: 'READY', payload: {} });
    return snapshots[0];
  }
  return { base, binding, terminal, token, otherTerminalId, snapshots, reads, snapshot, service, agreementModule,
    get context() { return context; }, get cas() { return cas; },
    setSource(roles: any[], users: any[]) { context.source = { roles, users }; context.sourceRevision++; context.sourceFingerprint = `fixture-${context.sourceRevision}`; },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); delete (globalThis as any).__posSecurityOriginalErp; },
  };
}
