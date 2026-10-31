import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { v3RefundAnchor } from '../services/sync/LargeMasterSyncV3StockAuthority';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const session = () => source('services/sync/LargeMasterSyncV3OperationalSession.ts');
const commit = () => source('services/sync/LargeMasterSyncV3FinancialCommit.ts');

/**
 * A credit note reverses a document that was already issued. These guards keep the reversal anchored
 * on the ticket's own snapshot: no catalog negotiation, no master drift blocking, and amounts that
 * repeat the issued rates instead of re-pricing them with today's master.
 */

const stamp = (extra: Record<string, unknown> = {}) => ({
  binding: '["t","term","dev","https://erp/api/sync","https://erp"]',
  syncId: 'aaaaaaaa-0000-4000-8000-000000000007', syncVersion: 7,
  inventoryVersion: 42, inventoryCursor: 'cursor-42', tariffId: 'tar-1', warehouseId: 'wh-1',
  taxIncluded: false, ...extra,
} as any);

test('the reversal anchor is the ticket inventory, not the live one', () => {
  assert.deepEqual(v3RefundAnchor(stamp()), { syncId: 'aaaaaaaa-0000-4000-8000-000000000007', syncVersion: 7,
    version: 42, cursor: 'cursor-42', contractVersion: 2 });
  const other = v3RefundAnchor(stamp({ inventoryVersion: 90, inventoryCursor: 'cursor-90' }));
  assert.equal(other.version, 90);
  assert.equal(other.cursor, 'cursor-90');
});

test('an explicit inventory sync id wins over the catalog stamp', () => {
  const anchor = v3RefundAnchor(stamp({ inventorySyncId: 'bbbbbbbb-0000-4000-8000-000000000001',
    inventorySyncVersion: 3 }));
  assert.equal(anchor.syncId, 'bbbbbbbb-0000-4000-8000-000000000001');
  assert.equal(anchor.syncVersion, 3);
});

test('a malformed explicit inventory authority is rejected, never silently ignored', () => {
  assert.throws(() => v3RefundAnchor(stamp({ inventorySyncId: 'bbbbbbbb-0000-4000-8000-000000000001' })),
    /SYNC_V3_STOCK_AUTHORITY_INVALID/);
  assert.throws(() => v3RefundAnchor(stamp({ inventorySyncVersion: 3 })), /SYNC_V3_STOCK_AUTHORITY_INVALID/);
});

test('the credit note is priced with the ticket tax generation, not the live master', async () => {
  const current = [{ id: 'ITBIS', type: 'VAT', rate: 0.16, active: true, name: 'ITBIS' }];
  const issued = [{ id: 'ITBIS', type: 'VAT', rate: 0.18, active: true, name: 'ITBIS' }];
  const mocks: Record<string, string> = {
    './LargeMasterSyncV3RetainedCheckout': 'export const readV3RetainedCheckout=async()=>undefined;export const assertV3RetainedLine=()=>{};',
    './LargeMasterSyncV3OperationalCatalog': 'export class LargeMasterSyncV3OperationalCatalog{static async open(){return{get:async()=>null}}}',
    './LargeMasterSyncV3Runtime': 'export class LargeMasterSyncV3Runtime{static retained(){return {}}}',
    './LargeMasterSyncV3CheckoutAuthority': 'export const buildLargeMasterSyncV3CheckoutFiscalInput=()=>{};',
    './LargeMasterSyncV3LineSource': 'export const validateV3PinnedLineSource=()=>{};export const validateV3FrozenLineFiscalAmounts=()=>{};',
    '../../utils/db': 'export const db={};', '../db': 'export const dbAdapter={};',
    './LargeMasterSyncV3Authority': 'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;export const assertLegacyMasterPullAllowed=()=>{};export const usesLargeMasterSyncV3Authority=()=>true;',
    './LargeMasterSyncV3Canary': 'export const LARGE_MASTER_SYNC_V3_CANARY=false;export const validateLargeMasterSyncV3CanaryUrl=x=>x;',
  };
  const bundle = await build({ entryPoints: [new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'fixture', setup(b) {
      b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: mocks[a.path], loader: 'js' }));
    } }] });
  const { LargeMasterSyncV3OperationalSession } = await import('data:text/javascript;base64,'
    + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const requested: Array<{ syncId: string; syncVersion: number }> = [];
  const s = new LargeMasterSyncV3OperationalSession(
    { runtime: { version: { syncId: 'new', syncVersion: 2 }, getOperationalTaxes: async () => current,
      getOperationalTariffs: async () => [{ id: 'tar-1', name: 'Público', taxIncluded: false }] },
      inventoryVersion: 42, inventoryCursor: 'cursor-42' },
    'B',
    { getInventoryAuthority: async () => ({ syncId: 'old', syncVersion: 1, version: 42, cursor: 'cursor-42' }),
      getOperationalTaxes: async input => { requested.push(input); return input.syncId === 'later' ? [{ id: 'NEW', type: 'VAT', rate: 0.1, active: true, name: 'Nuevo' }] : issued; },
      getOperationalTariffs: async () => [{ id: 'tar-1', name: 'Original', taxIncluded: true }],
      getCatalogReceipt: async () => ({ syncId: 'old', syncVersion: 1, version: 42, cursor: 'cursor-42' }) },
    'origin', { deviceId: 'device' });
  s.assertCurrent = async () => {};

  const refund = await s.projectRefundConfig({ terminals: [] } as any, stamp({ inventorySyncId: 'inventory-only', inventorySyncVersion: 99, taxIncluded: true }) as any);
  // The issued rate survives; the live 16% never re-prices the reversal.
  assert.equal(refund.taxes?.[0]?.rate, 0.18);
  assert.equal(refund.tariffs?.[0]?.taxIncluded, true);
  assert.deepEqual(requested, [{ syncId: 'aaaaaaaa-0000-4000-8000-000000000007', syncVersion: 7, contractVersion: 2 }]);
  // A sale keeps projecting today's master, unchanged.
  const sale = await s.projectConfig({ terminals: [] } as any);
  assert.equal(sale.taxes?.[0]?.rate, 0.16);
  const mixed = await s.projectRefundConfig({ terminals: [] } as any, stamp(), [
    { appliedTaxIds: ['ITBIS'], v3SaleAuthority: stamp() },
    { appliedTaxIds: ['NEW'], v3SaleAuthority: stamp({ syncId: 'later', syncVersion: 8 }) },
  ] as any);
  assert.deepEqual(mixed.taxes?.map(t => [t.id, t.rate]), [['ITBIS', .18], ['NEW', .1]]);
  const exempt = await s.projectRefundConfig({ terminals: [] } as any, stamp(), [
    { appliedTaxIds: [], v3SaleAuthority: stamp() },
  ] as any);
  assert.deepEqual(exempt.taxes, []);
});

test('validate only demands a live baseline for sales', () => {
  const src = session();
  assert.match(src, /const refund = intent === 'REFUND';/);
  assert.match(src, /!refund && \(authority\.inventoryVersion !== this\.ready\.inventoryVersion/);
  assert.match(src, /const anchor = refund \? v3RefundAnchor\(authority!\) :/);
  assert.match(src, /if \(old\.length !== 1\) throw new LargeMasterSyncV3Error\('SYNC_V3_RETAINED_TAX_CLASSIFICATION_CHANGED'\)/);
  assert.match(src, /if \(!refund\) throw new LargeMasterSyncV3Error\('SYNC_V3_RETAINED_TAX_CLASSIFICATION_CHANGED'\)/);
  // The notice is human-readable because it lands in the ERP journal NOTA.
  assert.match(src, /onTaxClassificationChanged\?\.\(\{ taxId: id, before: describe\(old\[0\]\)!/);
});

test('the reversal path never negotiates a master and reopens once after a sync', () => {
  const src = session();
  assert.match(src, /retainedSessionCoordinator = createLargeMasterSyncV3SessionCoordinator\(\n  \(_refresh, metric\) => LargeMasterSyncV3OperationalSession\.open\(false, metric, true\)/);
  assert.match(src, /if \(\(error as \{ code\?: string \}\)\?\.code !== 'SYNC_V3_RUNTIME_VERSION_CHANGED'\) throw error;\n  return retainedSessionCoordinator\(refresh\);/);
  const app = source('App.tsx');
  const gate = app.slice(app.indexOf('let refundConfig = config;'), app.indexOf('// 1. Calculations'));
  assert.match(gate, /getLargeMasterSyncV3RetainedSession\(\)/);
  assert.doesNotMatch(gate, /getLargeMasterSyncV3OperationalSession\(\)/);
  // Amounts must come from the ticket generation as well.
  assert.match(gate, /session\.projectRefundConfig\(config, stamp, normalizedRefundItems\)/);
});

test('a reversal-only batch posts locally while a sale batch keeps live authority', () => {
  const src = commit();
  assert.match(src, /const reversalOnly = entries\.every\(entry => entry\.options\?\.refund === true\);/);
  assert.match(src, /await \(reversalOnly \? getLargeMasterSyncV3RetainedSession\(\) : getLargeMasterSyncV3OperationalSession\(\)\)/);
  assert.match(src, /export const readV3CommittedRefundReplay[\s\S]{0,400}?getLargeMasterSyncV3RetainedSession\(\);await session\.assertCurrent\(\)/);
});

test('the drift travels to the ERP journal NOTA, never into the financial identity', () => {
  const app = source('App.tsx');
  // Evidence for accounting, deduplicated per tax, passed as an operation option...
  assert.match(app, /refundClassificationNotices\.some\(row => row\.taxId === notice\.taxId\)/);
  assert.match(app, /taxClassificationNotice: refundClassificationNotices/);
  // ...never as a field of the credit note: `metadata` is inside the immutable financial identity, so a
  // replay after any sync would look like a different document.
  assert.doesNotMatch(app, /metadata: \{ v3TaxClassificationNotice/);
  assert.doesNotMatch(app, /fiscalCorrectionAudit: \{/);
  // The observation rides the credit-note outbox payload, which the ERP turns into the journal NOTA.
  assert.match(source('services/sync/LargeMasterSyncV3FinancialCommit.ts'),
    /\.\.\.\(options\.taxClassificationNotice\?\.length \? \{ v3TaxClassificationNotice: options\.taxClassificationNotice \} : \{\}\)/);
  // The replay identity enumerates option fields explicitly; the observation is not one of them.
  const retention = source('services/db/LargeMasterSyncV3FinancialRetention.ts');
  const identity = retention.slice(retention.indexOf('export const financialOperationIdentity'));
  assert.doesNotMatch(identity, /taxClassificationNotice/);
});

// Execute the real checkout and retained-source guards: these cases must not be regex-only checks.
test('refund validation rejects malformed lines and missing receipts, and pins mixed generations to the original', async () => {
  const authority = { binding: 'B', warehouseId: 'W', tariffId: 'T', syncId: 'old', syncVersion: 1,
    inventoryVersion: 1, inventoryCursor: 'C', taxIncluded: false };
  const first = { id: 'P', cartId: 'P', quantity: 1, price: 100, taxable: true, appliedTaxIds: ['VAT'],
    type: 'SERVICE', activeInWarehouses: ['W'], v3SaleAuthority: authority };
  const second = { ...first, id: 'Q', cartId: 'Q', v3SaleAuthority: { ...authority, syncId: 'old-2',
    syncVersion: 2, inventorySyncId: 'old', inventorySyncVersion: 1 } };
  const rows = [first, second];
  (globalThis as any).__refundGuards = { items: rows };
  const mocks: Record<string, string> = {
    './LargeMasterSyncV3OperationalCatalog': 'export class LargeMasterSyncV3OperationalCatalog { static async open(){return {get:async id=>{const p=globalThis.__refundGuards.items.find(p=>p.id===id);return p?{product:p,authority:p.v3SaleAuthority}:null}}} }',
    './LargeMasterSyncV3Runtime': 'export class LargeMasterSyncV3Runtime { static retained(){return {}} }',
    '../../utils/db': 'export const db={getDocument:async()=>({id:"original",items:globalThis.__refundGuards.items})};',
    '../db': 'export const dbAdapter={};',
    './LargeMasterSyncV3Authority': 'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;export const assertLegacyMasterPullAllowed=()=>{};export const usesLargeMasterSyncV3Authority=()=>true;',
    './LargeMasterSyncV3Canary': 'export const LARGE_MASTER_SYNC_V3_CANARY=false;export const validateLargeMasterSyncV3CanaryUrl=x=>x;',
  };
  const bundle = await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],
    bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'refund-guards',setup(b){
      b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'guards'}:undefined);
      b.onLoad({filter:/.*/,namespace:'guards'},a=>({contents:mocks[a.path],loader:'js'}));
    }}]});
  const {LargeMasterSyncV3OperationalSession} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const taxes=[{id:'VAT',name:'Original',type:'VAT',rate:.18}];
  const store:any={getOperationalTaxes:async()=>taxes,
    getCatalogReceipt:async()=>({syncId:'old',syncVersion:1,version:1,cursor:'C'})};
  const session=new LargeMasterSyncV3OperationalSession({runtime:{version:{syncId:'today',syncVersion:9},
    getOperationalTaxes:async()=>[]},inventoryVersion:9,inventoryCursor:'today'},'B',store,'origin',{deviceId:'device'});
  session.assertCurrent=async()=>{};
  const validate=(lines:any[])=>session.validate({terminals:[],taxes},lines,'T','W','REFUND',undefined,{originalTransactionId:'original'});
  const notices:any[]=[];
  await session.validate({terminals:[],taxes},rows,'T','W','REFUND',undefined,{originalTransactionId:'original'},false,n=>notices.push(n));
  assert.equal(notices.length,2); // Both deleted live taxes only warn.
  await assert.rejects(()=>validate([{...first,appliedTaxIds:undefined}]),/SYNC_V3_LINE_INVALID/);
  await assert.rejects(()=>validate([{...first,appliedTaxIds:[]}]),/SYNC_V3_LINE_INVALID/);
  await assert.rejects(()=>validate([{...first,price:999}]),/SYNC_V3_RETAINED_LINE_CHANGED/);
  await assert.rejects(()=>validate([first,{...second,v3SaleAuthority:{...second.v3SaleAuthority,inventoryVersion:2}}]),/SYNC_V3_CART_MIXED_VERSION/);
  delete store.getCatalogReceipt;
  await assert.rejects(()=>validate([first]),/SYNC_V3_RETAINED_OWNER_REQUIRED/);
  // Even a still-current catalog cannot authorize repricing the issued original.
  session.ready.runtime.version={syncId:'old',syncVersion:1};
  await validate([first]);
  await assert.rejects(()=>validate([{...first,price:999}]),/SYNC_V3_RETAINED_LINE_CHANGED/);
});
