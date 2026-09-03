import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { syncErpPaymentMethods } from '../services/sync/PaymentMethodsSync';
import { allowsDefaultPaymentMethods, readErpPaymentMethodsSnapshot } from '../utils/erpPaymentMethods';

const managerSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const methods = managerSource.slice(managerSource.indexOf('    private paymentMethodsRefresh:'), managerSource.indexOf('    private async refreshTerminalSupplementalMasterData('));
function fixture(kind = 'ERP_ACTIVE') {
  const target = { kind, terminalId: 't1', baseUrl: 'https://erp.test/api/sync', canPullMasters: kind !== 'NONE' };
  const state = { config: { paymentMethods: [], terminals: [] }, fetches: 0, events: [] as string[], collection: [] };
  let pending: Promise<any[]> = Promise.resolve([{ id: 'pm', name: 'Efectivo', type: 'cash', active: true }]);
  const Ctor = runInNewContext(ts.transpile(`class Subject { ${methods} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), {
    syncPolicy: { resolve: () => ({ ...target }) }, syncErpPaymentMethods,
    apiSyncAdapter: { pullPaymentMethodsSnapshot: () => { state.fetches++; return pending; } },
    db: { get: async () => state.config, save: async (collection: string, data: any) => { if (collection === 'config') state.config = data; else state.collection = data; } },
    window: { dispatchEvent: (event: any) => state.events.push(event.type) },
    CustomEvent: class { constructor(public type: string, public detail: any) {} },
  });
  return { manager: new Ctor(), target, state, setPending(value: Promise<any[]>) { pending = value; } };
}

test('production manager coalesces concurrent refresh and emits checkout config after persistence', async () => {
  const f = fixture(); let release!: (value: any[]) => void;
  f.setPending(new Promise(resolve => { release = resolve; }));
  const a = f.manager.refreshErpPaymentMethods(); const b = f.manager.refreshErpPaymentMethods();
  release([{ id: 'pm', type: 'cash', name: 'ERP cash', active: true }]);
  assert.deepEqual(await Promise.all([a, b]), [1, 1]);
  assert.equal(f.state.fetches, 1);
  assert.deepEqual(f.state.events, ['paymentMethodsUpdated', 'configUpdated']);
  assert.equal(f.state.config.paymentMethods.length, 1);
});

test('local/cloud-staging modes do not request or overwrite ERP payment methods', async () => {
  for (const mode of ['POS_MASTER', 'POS_CLOUD_STAGING', 'NONE']) {
    const f = fixture(mode);
    assert.equal(await f.manager.refreshErpPaymentMethods(), 0);
    assert.equal(f.state.fetches, 0);
    assert.equal(f.state.events.length, 0);
  }
});

test('terminal switch during download discards old response; failure releases single-flight lock', async () => {
  const f = fixture(); let release!: (value: any[]) => void;
  f.setPending(new Promise(resolve => { release = resolve; }));
  const work = f.manager.refreshErpPaymentMethods();
  f.target.terminalId = 't2'; release([]);
  await assert.rejects(work, /TARGET_CHANGED/);
  assert.equal(f.state.events.length, 0);
  f.setPending(Promise.resolve([]));
  assert.equal(await f.manager.refreshErpPaymentMethods(), 0);
  assert.equal(f.state.fetches, 2);
});

test('strict API snapshot path keeps transport errors distinct from successful empty list', async () => {
  const source = readFileSync(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('    async pullPaymentMethodsSnapshot()'), source.indexOf('    private async getOperationalPayload<T'));
  const Ctor = runInNewContext(ts.transpile(`class Subject { ${method} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), { readErpPaymentMethodsSnapshot });
  const adapter = new Ctor();
  adapter.getOperationalPayload = async (path: string, operation: string) => {
    assert.equal(path, '/collections/paymentMethods/data'); assert.equal(operation, 'PULL_MASTERS'); return { items: [], count: 0 };
  };
  assert.deepEqual(await adapter.pullPaymentMethodsSnapshot(), []);
  adapter.getOperationalPayload = async () => { throw new Error('HTTP 409'); };
  await assert.rejects(adapter.pullPaymentMethodsSnapshot(), /HTTP 409/);
});

test('regular manifest and manual collection refresh reach the payment bridge, even without snapshot block', () => {
  const manifest = managerSource.slice(managerSource.indexOf('    async syncTerminalManifestInBackground('), managerSource.indexOf('    private async deleteSnapshotProducts('));
  assert.match(manifest, /await this.refreshErpPaymentMethods\(\)/);
  const pull = managerSource.slice(managerSource.indexOf('    async pullCatalog('), managerSource.indexOf('        // A local database reset'));
  assert.match(pull, /collection === 'paymentMethods' && target.kind === 'ERP_ACTIVE'[\s\S]*return this.refreshErpPaymentMethods\(\)/);
});


test('checkout never fabricates default or wallet methods for an authoritative disabled/empty ERP list', () => {
  const source = readFileSync(new URL('../components/PaymentModal.tsx', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('   const configuredMethods = useMemo'), source.indexOf('   const selectPaymentMethod'));
  const resolve = (config: any) => runInNewContext(ts.transpile(`${code}\nconfiguredMethods;`, { target: ts.ScriptTarget.ES2022 }), {
    config, customer: { wallet: { balance: 100 } }, allowsDefaultPaymentMethods,
    useMemo: (fn: () => any) => fn(), PAYMENT_ICON_BY_NAME: {},
    normalizeRuntimePaymentMethodDefinition: (method: any) => ({ definition: method }),
    getDefaultLabelByType: (type: string) => type, getDefaultIconByType: () => null,
    Banknote: null, CreditCard: null, QrCode: null, Wallet: null,
  });
  assert.equal(resolve({ paymentMethodsSource: 'ERP', paymentMethods: [] }).length, 0);
  assert.equal(resolve({ paymentMethodsSource: 'ERP', paymentMethods: [{ id: 'disabled', type: 'CASH', isEnabled: false }] }).length, 0);
  assert.equal(resolve({ paymentMethods: [] }).length, 4, 'legacy defaults plus customer wallet unchanged');
  const active = resolve({ paymentMethodsSource: 'ERP', paymentMethods: [{ id: 'transfer', name: 'Transferencia', type: 'CASH', isEnabled: true }] });
  assert.equal(active.length, 1); assert.equal(active[0].id, 'transfer');
});

test('kiosk keeps legacy defaults but respects ERP empty and credit-only configurations', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const resolveKioskPaymentMethods ='), source.indexOf('const createKioskGatewayOrderNumber'));
  const resolve = runInNewContext(ts.transpile(`${code}\nresolveKioskPaymentMethods;`, { target: ts.ScriptTarget.ES2022 }), { allowsDefaultPaymentMethods });
  assert.equal(resolve({ paymentMethods: [] }).length, 2);
  assert.equal(resolve({ paymentMethodsSource: 'ERP', paymentMethods: [] }).length, 0);
  assert.equal(resolve({ paymentMethodsSource: 'ERP', paymentMethods: [{ id: 'credit', type: 'CREDIT', isEnabled: true }] }, { wallet: { status: 'ACTIVE', balance: 100 } }).length, 0);
});
