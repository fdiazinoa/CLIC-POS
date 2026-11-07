/** Loopback-only disposable laboratory. Real React modal, POS/App callbacks,
 * Native SQLite writer and ERP SQL; auth, device platform and masters are fixtures.
 * No operational bootstrap, credentials, .env, provider, printer or production IO. */
import { register } from 'node:module';
import { localPgClient } from './pg-client.mts';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import ts from 'typescript';
import SQLite from 'better-sqlite3';
import { dispatchCommercialSource, dispatchPaymentIntents } from '../../services/db/CompanyDispatchEscrowStore';
import {financialIdentity} from '../../services/db/LargeMasterSyncV3FinancialRetention';
import { nativeFixture } from '../../tests/articleFormatsNativeFixture';
import { getInitialConfig } from '../../constants';
import { SubVertical } from '../../types';
const repo = process.cwd(), erp = resolve(repo, '../CLIC-ERP-company-dispatch');
if (process.env.CLIC_DISPATCH_TEST_PG_PORT !== '55443')
    throw Error('Explicit isolated PG55443 required');
register('data:text/javascript,' + encodeURIComponent("export async function resolve(specifier,context,next){if(specifier.endsWith('/supabaseClient.js'))return {url:'data:text/javascript,'+encodeURIComponent('export default new Proxy({}, {get:(_t,k)=>(...args)=>globalThis.__dispatchLab.erpClient[k](...args)});'),shortCircuit:true};return next(specifier,context);}"));
const { createCompanyDispatchErpFlowFixture } = await import(erp + '/server/services/companyDispatch.erpFlow.fixture.js');
const f = await createCompanyDispatchErpFlowFixture(), dir = await mkdtemp(resolve(tmpdir(), 'clic-dispatch-ui-'));
process.once('uncaughtException', async (error) => { console.error(error); await f.close(); await rm(dir, { recursive: true, force: true }); process.exit(1); });
const sqlite = new SQLite(resolve(dir, 'native.sqlite'));
sqlite.exec('CREATE TABLE documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id))');
await writeFile(resolve(dir, 'manifest.json'), JSON.stringify({ database: f.db.database, port: 55443, host: '127.0.0.1', laboratoryOnly: true }), { mode: 0o600 });
const n = await nativeFixture(sqlite, false);
await (n.adapter as any).initSchema();
Object.assign(n.adapter, { isReady: true });
const ids = { ...f.ids, terminal: randomUUID(), device: 'lab-device-' + randomUUID(), tariff: randomUUID(), series: randomUUID(), sync: randomUUID() }, fingerprint = 'a'.repeat(64);
await f.db.query("insert into erp_terminals select(jsonb_populate_record(null::erp_terminals,to_jsonb(t)||jsonb_build_object('id',$1::text,'store_id',$2::text,'device_id',$3::text,'authorized_device_id',$3::text,'config',jsonb_build_object('security',jsonb_build_object('deviceTokenFingerprint',$4::text))))).* from erp_terminals t where id=$5", [ids.terminal, ids.store, ids.device, fingerprint, f.ids.terminal]);
await f.db.query('insert into erp_tariffs(id,tenant_id,company_id)values($1,$2,$3)', [ids.tariff, ids.tenant, ids.company]);
await f.db.query("update items set metadata=(metadata-'articleFormats'-'article_formats')||jsonb_build_object('tariffs',jsonb_build_array(jsonb_build_object('tariffId',$2::text,'price',50))) where id=$1", [ids.item, ids.tariff]);
const no = () => { }, global = globalThis as any;
global.window = { dispatchEvent: no, setTimeout, clearTimeout };
global.localStorage = { getItem: (key: string) => key === 'pos_device_id' ? ids.device : null, setItem: no, removeItem: no };
const binding = JSON.stringify([ids.tenant, ids.terminal, ids.device, 'https://erp.invalid', 'https://erp.invalid']);
const config: any = getInitialConfig(SubVertical.SUPERMARKET);
Object.assign(config, { id: 'current', fiscalCompliance: { mode: 'NONE' }, currencies: [{ code: 'DOP', symbol: 'RD$', rate: 1, isBase: true, isEnabled: true }], paymentMethods: [{ id: 'cash', type: 'CASH', name: 'Efectivo', isEnabled: true }], integrations: [], taxes: [], tariffs: [{ id: ids.tariff, name: 'Precio de laboratorio', isActive: true }], terminals: [{ id: ids.terminal, config: { erpTerminalId: ids.terminal, currentDeviceId: ids.device, erpBinding: { tenantId: ids.tenant, companyId: ids.company, storeId: ids.store }, inventoryScope: { defaultSalesWarehouseId: ids.warehouse }, documentAssignments: { TICKET: ids.series } } }] });
const put = (collection: string, doc: any) => n.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(collection, doc.id, JSON.stringify(doc), 0, 'synthetic');
put('config', config);
put('internalSequences', { id: ids.series, documentType: 'TICKET', prefix: 'TCK-LAB-', padding: 6, nextNumber: 1 });
put('globalSequenceCounter', { id: 'value', count: 0 });
n.db.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1').run(ids.sync, 32);
n.db.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run(ids.sync, 32, binding);
n.db.prepare('INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,?)').run(ids.sync, 32, 4, 'lab-inventory', 'synthetic');
n.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)VALUES(?,32,3,2,'ACTIVE','{}','synthetic','synthetic')").run(ids.sync);
const product = { id: ids.item, name: 'Artículo sintético', type: 'PRODUCT', inventoriable: true, active: true, sellable: true, taxable: false, taxIds: [], variants: [], cost: 10, activeWarehouseIds: [ids.warehouse], operationalFlags: { trackInventory: true, allowNegativeStock: false } };
n.db.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(ids.item, ids.warehouse, 10, 0, 0, 'synthetic');
n.db.prepare('INSERT INTO master_v3_articles(sync_version,article_id,taxable,tax_ids_json,active,sellable,record_json)VALUES(32,?,0,?,1,1,?)').run(ids.item, '[]', JSON.stringify(product));
n.db.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json)VALUES(32,?,1,?)').run(ids.tariff, JSON.stringify({ id: ids.tariff, name: 'Laboratorio', active: true, taxIncluded: false }));
n.db.prepare('INSERT INTO master_v3_prices VALUES(32,?,?,50)').run(ids.item, ids.tariff);
global.__dispatchLab = { adapter: n.adapter, identity: { tenantId: ids.tenant, terminalId: ids.terminal, deviceId: ids.device, erpSyncBaseUrl: 'https://erp.invalid' }, db: { get: (c: string) => n.adapter.getCollection(c), getDocument: (...a: any[]) => n.adapter.getDocument(...a), reserveTransactionNumbers: (seriesId: string, documentType: string) => n.adapter.reserveFinancialNumbers({ seriesId, documentType, global: true }), assertFiscalTransactionAuthority: async () => { } }, session: null };
const ports: Record<string, string> = {
    '@capacitor/core': "export const buildRequestInit=()=>{throw Error('NO_EXTERNAL_HTTP')};export class WebPlugin{};export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android'};export const registerPlugin=()=>({});export const CapacitorHttp={request:async()=>{throw Error('NO_EXTERNAL_HTTP')}};",
    '../db': 'export const dbAdapter=globalThis.__dispatchLab.adapter;', '../../utils/db': 'export const db=globalThis.__dispatchLab.db;', '../utils/db': 'export const db=globalThis.__dispatchLab.db;',
    './sync/SyncManager': 'export const syncManager={broadcastChange:async()=>{}};', './sync/BackgroundSyncManager': 'export const backgroundSyncManager={triggerSync:async()=>{}};',
    './SyncFeatureFlags': 'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2";', './sync/SyncFeatureFlags': 'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2";',
    './LargeMasterSyncV3OperationalSession': 'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__dispatchLab.session;export const getLargeMasterSyncV3RetainedSession=async()=>globalThis.__dispatchLab.session;export const v3InventoryBaselineKey=(b,s)=>JSON.stringify([b,s.inventorySyncId||s.syncId,s.inventorySyncVersion??s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
    './LargeMasterSyncV3BoundTransport': 'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__dispatchLab.identity;export const validatedLargeMasterSyncV3ErpSyncBase=v=>v;export const createLargeMasterSyncV3BoundClient=()=>{throw Error("NO_EXTERNAL_NETWORK")};export const createLargeMasterSyncV3BoundTransport=()=>{throw Error("NO_EXTERNAL_NETWORK")};',
    './DurableOutboxRepository': 'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__dispatchLab.adapter.commitFinancialTransaction(i)};', '../CheckoutDiagnostics': 'export const recordCheckoutDiagnostic=()=>{};', './CheckoutDiagnostics': 'export const recordCheckoutDiagnostic=()=>{};'
};
ports['./sync/LargeMasterSyncV3OperationalSession'] = ports['./LargeMasterSyncV3OperationalSession'];
const runtimeEntry = `export {LargeMasterSyncV3Runtime} from './services/sync/LargeMasterSyncV3Runtime';export {LargeMasterSyncV3OperationalSession} from './services/sync/LargeMasterSyncV3OperationalSession';export {transactionService} from './services/transactionService';export {persistV3FinancialTransaction} from './services/sync/LargeMasterSyncV3FinancialCommit';export {synchronizeNativeCompanyDispatch} from './services/dispatch/CompanyDispatchRuntime';export {installNativeDispatchPool} from './services/dispatch/DispatchPoolInstallation';export {DurableOutboxRepository} from './services/sync/DurableOutboxRepository';export {DurableOutboxBatchSender} from './services/sync/DurableOutboxBatchSender';export {readDispatchAdoptionProofs} from './services/dispatch/DispatchAdoptionClient';`;
const built = await build({ stdin: { contents: runtimeEntry, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'declared-lab-boundaries', setup(b) { b.onResolve({ filter: /.*/ }, a => ports[a.path] ? { path: a.path, namespace: 'lab' } : undefined); b.onLoad({ filter: /.*/, namespace: 'lab' }, a => ({ contents: ports[a.path], loader: 'js' })); } }] });
await writeFile(resolve(dir, 'runtime.mjs'), built.outputFiles[0].text);
const r = await import(resolve(dir, 'runtime.mjs'));
const store = n.adapter.masterSyncV3Store, runtime = await r.LargeMasterSyncV3Runtime.open(store);
global.__dispatchLab.session = new r.LargeMasterSyncV3OperationalSession({ runtime, inventoryVersion: 4, inventoryCursor: 'lab-inventory' }, binding, store, 'https://erp.invalid', global.__dispatchLab.identity);
const session = global.__dispatchLab.session;
const queryClient = { rpc: async (name: string, args: any) => {
        await f.db.query('set role service_role');
        try {
            return { data: (await f.db.query(`select public.${name}(${Object.values(args).map((_, i) => '$' + (i + 1)).join(',')}) result`, Object.values(args))).rows[0].result, error: null };
        }
        catch (error) {
            return { error };
        }
        finally {
            await f.db.query('reset role');
        }
    }, from(table: string) {
        if (!['erp_sync_inbox', 'erp_dispatch_quotas', 'erp_terminals', 'erp_dispatch_native_captures'].includes(table))
            throw Error('Unexpected table');
        const values: any[] = [], filters: string[] = [];
        let single = false, limit = 200;
        const q: any = { select() { return q; }, eq(k: string, v: any) { values.push(v); filters.push(`q.${k}=$${values.length}`); return q; }, in(k: string, v: any) { values.push(v); filters.push(`q.${k}=any($${values.length})`); return q; }, limit(v: number) { limit = v; return q; }, maybeSingle() { single = true; return q; }, async then(done: any) {
                try {
                    const source = table === 'erp_dispatch_native_captures' ? "erp_dispatch_native_captures q join erp_dispatch_bindings b on b.id=q.binding_id" : 'public.' + table + ' q', projection = table === 'erp_dispatch_native_captures' ? "q.*,jsonb_build_object('terminal_id',b.terminal_id,'store_id',b.store_id,'device_id',b.device_id) binding" : 'q.*';
                    const rows = (await f.db.query(`select ${projection} from ${source} where ${filters.join(' and ') || 'true'} limit ${limit}`, values)).rows;
                    done({ data: single ? rows[0] || null : rows, error: null });
                }
                catch (error) {
                    done({ error });
                }
            } };
        return q;
    } };
const { createCompanyDispatchNativeHandler } = await import(erp + '/server/services/companyDispatchNative.js'), nativeHandler = createCompanyDispatchNativeHandler({ client: queryClient }), scope = { tenantId: ids.tenant, companyId: ids.company, storeId: ids.store, terminalId: ids.terminal, deviceId: ids.device }, context = { tenant: { id: ids.tenant }, company: { id: ids.company }, store: { id: ids.store }, terminal: { id: ids.terminal, device_id: ids.device, config: { security: { deviceTokenFingerprint: fingerprint } } } };
const transport = { request: async (path: string, options: any = {}) => { const url = new URL(path, 'http://127.0.0.1'), res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(data: any) { this.data = data; return this; } }; await nativeHandler({ method: options.method || 'GET', query: Object.fromEntries(url.searchParams), body: options.body, headers: { 'x-company-dispatch-contract': '1', 'x-device-id': ids.device } }, res, context); return { status: res.statusCode, text: JSON.stringify(res.data) }; } };
const witness = { readWitness: async (k: string) => {
        try {
            return await readFile(resolve(dir, Buffer.from(k).toString('hex')), 'utf8');
        }
        catch {
            return null;
        }
    }, writeWitness: (k: string, v: string) => writeFile(resolve(dir, Buffer.from(k).toString('hex')), v, { mode: 0o600 }) };
const sync = () => r.synchronizeNativeCompanyDispatch(transport, n.adapter, (s: any, h: string) => r.installNativeDispatchPool(s, h, { ...witness, readLocal: (...a: any[]) => n.adapter.readDispatchPoolInstallation!(...a), install: (...a: any[]) => n.adapter.installDispatchPoolSnapshot!(...a) }), witness);
const prepare = await f.command('setPolicy', { mode: 'WAREHOUSE_DISPATCH' });
await f.command('prepareBarrier');
await sync();
await f.command('setPolicy', { mode: 'WAREHOUSE_DISPATCH', phase: 'activate', transitionId: prepare.transition_id, expectedRevision: prepare.revision });
await sync();
const current = await n.adapter.readDispatchCheckoutAuthority!();
await f.command('issueQuota', { bindingId: current.bindingId, lines: [{ itemId: ids.item, warehouseId: ids.warehouse, quantity: 4 }] });
await sync();
console.log('REAL_POOL_INSTALLED', await n.adapter.readDispatchActivePoolState!());
// HTTP/browser layer follows below. No business fixture authority is seeded above.
function callback(file: string, name: string, bindings: Record<string, any>) {
    const source = ts.createSourceFile(file, requireText(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let arrow: ts.Expression | undefined;
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name)
            arrow = node as unknown as ts.Expression;
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer)
            arrow = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(source);
    if (!arrow)
        throw Error('Callback missing ' + name);
    return new Function(...Object.keys(bindings), ts.transpileModule('const handler=' + arrow.getText(source) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + 'return handler;')(...Object.values(bindings));
}
const sources = new Map<string, string>();
for (const file of ['App.tsx', erp + '/server/routes/syncInbox.js'])
    sources.set(file, await readFile(file, 'utf8'));
function requireText(file: string) { return sources.get(file)!; }
const { assertFormatsPostingClosed } = await import('../../services/articleFormats/activation');
const appComplete = callback('App.tsx', 'handleTransactionComplete', { dbAdapter:n.adapter,financialIdentity,assertFormatsPostingClosed, config, deviceId: ids.device, db: global.__dispatchLab.db, LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED: true, persistV3FinancialTransaction: r.persistV3FinancialTransaction, fiscalSinglePreparation: { commit: () => { throw Error('NO_FISCAL_NONE'); } }, readV3CompletedReservation: () => { throw Error('NO_RESERVATION_FIXTURE'); }, setTransactions: no, setCustomers: no, syncFiscalDocument: async () => { }, backgroundSyncManager: { triggerSync: async () => { } }, console });
const { normalizePosInboxEventPayload } = await import(erp + '/server/services/posSaleEventContract.js');
const { V3_PLAN_KEY } = await import(erp + '/server/services/fiscal/posFiscalV3Source.js');
const envelope = callback(erp + '/server/routes/syncInbox.js', 'buildPosEventEnvelope', { normalizePosInboxEventPayload, V3_PLAN_KEY });
const { applyCompanyDispatchSale } = await import(erp + '/server/services/companyDispatchApplication.js'), { buildPosSyncEventResult } = await import(erp + '/server/services/posSyncEventOutcome.js'), { attachDispatchAdoptionProofs } = await import(erp + '/server/services/companyDispatchAck.js');
global.__dispatchLab.erpClient = localPgClient(f.db);
const { applySyncInboxEventById } = await import(erp + '/server/services/posEventApplier.js');
async function flush() {
    const repo = new r.DurableOutboxRepository(n.adapter), sender = new r.DurableOutboxBatchSender(repo, async (events: any[]) => {
        const eventResults = [];
        for (const event of events) {
            const inbox = randomUUID(), received = envelope({ ...context, terminal: context.terminal, eventId: event.eventId, eventType: event.eventType, payload: event.payload });
            await f.db.query("insert into erp_sync_inbox(id,event_id,event_type,status,tenant_id,store_id,terminal_id,payload)values($1,$2,$3,'PROCESSING',$4,$5,$6,$7) on conflict(event_id)do nothing", [inbox, event.eventId, event.eventType, ids.tenant, ids.store, ids.terminal, received.payload]);
            const row = (await f.db.query('select * from erp_sync_inbox where event_id=$1', [event.eventId])).rows[0];
            if (event.eventType !== 'SALE_POSTED') {
                await f.db.query("update erp_sync_inbox set status='RECEIVED' where id=$1", [row.id]);
                const applied = await applySyncInboxEventById(row.id);
                eventResults.push(buildPosSyncEventResult({ event, syncId: row.id, application: applied }));
                continue;
            }
            const application = await applyCompanyDispatchSale(queryClient, row, scope);
            await f.db.query("update erp_sync_inbox set status='APPLIED',payload=payload||jsonb_build_object('application_result',$2::jsonb) where id=$1", [row.id, JSON.stringify(application)]);
            eventResults.push(buildPosSyncEventResult({ event, syncId: row.id, application: { inboxStatus: 'APPLIED', applicationResult: application } }));
        }
        return { eventResults: await attachDispatchAdoptionProofs(queryClient, { scope, events, eventResults }) };
    }, (eventIds: string[]) => r.readDispatchAdoptionProofs(eventIds, transport));
    return sender.sendNext(new Date());
}
async function state() { const financials = { journals: (await f.db.query('select id,source_document_type,total_debit,total_credit from erp_accounting_journal_entries where company_id=$1 order by source_document_type,id', [ids.company])).rows, lines: (await f.db.query('select j.source_document_type,l.account_code,l.debit_amount,l.credit_amount from erp_accounting_journal_lines l join erp_accounting_journal_entries j on j.id=l.journal_entry_id where j.company_id=$1 order by j.source_document_type,l.account_code', [ids.company])).rows, receipts: Number((await f.db.query('select count(*) n from erp_journal_entries where company_id=$1', [ids.company])).rows[0].n) }; return { financials, physical: Number((await f.db.query('select sum(qty_physical) n from erp_stock_balance where company_id=$1 and item_id=$2', [ids.company, ids.item])).rows[0].n), effects: Number((await f.db.query('select count(*) n from erp_dispatch_effects where company_id=$1', [ids.company])).rows[0].n), quotas: n.db.prepare('select id,granted_minor,consumed_minor from pos_dispatch_quota_v1').all(), outbox: n.db.prepare('select event_id,status,aggregate_id from sync_outbox_v2').all(), documents: (await f.db.query('select id,codigo,tipo_documento,metadata from erp_sales_documents where company_id=$1 order by fecha', [ids.company])).rows }; }
const originalCommit = n.adapter.commitFinancialTransaction.bind(n.adapter);
n.adapter.commitFinancialTransaction = async (input) => {
    const doc = input.documents.find(x => x.collectionName === 'transactions')?.document as any;
    if (input.dispatchCommit && doc) {
        const p = n.db.prepare('select source_json,effects_json from pos_dispatch_precharge_v1 where checkout_id=?').get(input.dispatchCommit.checkoutId) as any, expected = JSON.parse(p.source_json), actual = JSON.parse(dispatchCommercialSource(doc));
        console.log('LAB_INTENT_MATCH', { source: JSON.stringify(expected) === JSON.stringify(actual), payments: p.effects_json === dispatchPaymentIntents(doc.payments) });
    }
    return originalCommit(input);
};
const op: Record<string, (...a: any[]) => any> = { sync, flush, state, replayPayments: async () => { const before = await state(), rows = (await f.db.query("select id from erp_sync_inbox where store_id=$1 and event_type='PAYMENT_POSTED' and status='APPLIED'", [ids.store])).rows; if (!rows.length)
        throw Error('PAYMENT_NOT_APPLIED'); const results = []; for (const row of rows)
        results.push(await applySyncInboxEventById(row.id)); const after = await state(); if (JSON.stringify(before) !== JSON.stringify(after))
        throw Error('PAYMENT_REPLAY_CHANGED_EFFECTS'); return { unchanged: true, results }; }, sessionValidate: (lines: any[]) => session.validate(config, lines, ids.tariff, ids.warehouse, 'SALE'), transactionCreate: (...a: any[]) => r.transactionService.createTransaction(...a), appComplete, sessionSearch: async () => [(await (await session.catalog(ids.tariff, ids.warehouse)).get(ids.item)).product], sessionResolve: async () => null };
for (const name of ['getDocument', 'getCollection', 'saveDocument', 'readDispatchActivePoolState', 'readDispatchPendingCheckout', 'readDispatchCheckoutAuthority', 'prepareDispatchPrecharge', 'markDispatchEffectPossible', 'dispatchNativeSchemaHash', 'getTrackingOperationReceipt'])
    op['adapter.' + name] = (...a: any[]) => (n.adapter as any)[name](...a);
const projected = await session.projectConfig(config), item = await session.withStock((await (await session.catalog(ids.tariff, ids.warehouse)).get(ids.item)).product, ids.warehouse);
projected.inventoryDispatch = (await f.db.query('select config from erp_companies where id=$1', [ids.company])).rows[0].config.inventoryDispatch;
Object.assign(config, projected);
config.terminals[0].config.inventoryDispatch = config.inventoryDispatch;
const input = { config, item, ids, series: { id: ids.series, documentType: 'TICKET', prefix: 'TCK-LAB-', padding: 6, nextNumber: 1 } };
const cssFiles = (await readdir(resolve(repo, 'dist/assets')).catch(() => [])).filter(x => x.endsWith('.css'));
const appCss = (await Promise.all(cssFiles.map(x => readFile(resolve(repo, 'dist/assets', x), 'utf8')))).join('\n');
const browserPorts: Record<string, string> = {
    'settingsService': `export const settingsApi={get:async(path,options={})=>{const r=await fetch('/api'+path+'?'+new URLSearchParams(Object.entries(options.params||{}).filter(([,v])=>v!==undefined&&v!==null)));const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message),{response:{status:r.status,data}});return{data};},post:async(path,body)=>{const r=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message),{response:{status:r.status,data}});return{data};}};`,
    'activeCompanyContext': `export const ACTIVE_COMPANY_CHANGED_EVENT='lab-company-changed';export const resolveActiveCompanyId=async()=>window.labInput.ids.company;`,
    'usePermissions': `const can=(module,action)=>['SALES_INVOICES','SALES_WAYBILLS','INVENTORY_BIN_STOCK'].includes(module)&&['VIEW','INSERT','UPDATE'].includes(action);export const usePermissions=()=>({can});`,
    'accountingSetupService': `export default{loadSetup:async()=>({context:{tenantId:window.labInput.ids.tenant,companyId:window.labInput.ids.company}})};`,
    'documentSeriesResolution': `export const reserveNextErpWebSalesDocumentCode=async()=>({codigo:'CON-LAB-'+crypto.randomUUID().slice(0,8),seriesId:null});`,
    'supabaseClient': `export const supabase={};`,
    'db': `const call=(name,args)=>window.labCall('adapter.'+name,args);export const dbAdapter=new Proxy({isNative:true,inventoryPresentationsSQL:undefined},{get:(t,k)=>k in t?t[k]:(...args)=>call(k,args)});`,
    'utilsDb': `export const db={get:n=>window.labCall('adapter.getCollection',[n]),getDocument:(...a)=>window.labCall('adapter.getDocument',a),saveDocument:(...a)=>window.labCall('adapter.saveDocument',a),assertFiscalTransactionAuthority:async()=>{},getConfig:async()=>window.labInput.config};`,
    'transaction': `export const transactionService={createTransaction:(...a)=>window.labCall('transactionCreate',a)};`,
    'runtime': `export const synchronizeNativeCompanyDispatch=()=>window.labCall('sync',[]);`,
    'fiscal': `export const verifyFiscalWorkflowState=()=>{throw Error('LAB_FISCAL_DISABLED')};export const fiscalWorkflowV2Client={enabled:()=>false,offlineReady:async()=>false,pendingCheckoutInfo:async()=>null,retirementCandidate:async()=>null,capability:()=>null,subscribe:()=>()=>{},prefetch:async()=>null,offlineReadiness:async()=>({ready:false}),offlineStatus:async()=>({ready:false,remaining:0,remainingByType:{}}),available:async()=>0};`,
    'network': `export const networkSyncService={getStatus:()=>({isOnline:false,isMaster:true}),subscribe:()=>()=>{},getDeviceId:()=>window.labInput.ids.device};`,
    'cap': `export const buildRequestInit=()=>{throw Error('NO_EXTERNAL_HTTP')};export class WebPlugin{};export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>false};export const CapacitorHttp={request:async()=>{throw Error('NO_EXTERNAL_HTTP')}};export const registerPlugin=name=>new Proxy({},{get:()=>async()=>{throw Error('LAB_NATIVE_PLUGIN_UNSUPPORTED:'+name)}});`,
    'outbox': `export const durableOutboxRepository={isSupported:()=>true};`,
    'uber': `export const resolveUberEatsPosContext=()=>null;export const fetchUberEatsPendingOrders=async()=>[];export const fetchUberEatsOrderDraft=async()=>{throw Error('LAB_NO_UBER')};export const confirmUberEatsPosInvoice=async()=>{throw Error('LAB_NO_UBER')};`,
    'syncManager': `export const syncManager={broadcastChange:async()=>{},subscribe:()=>()=>{}};`,
};
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import POS from './components/POSInterface';import{BrowserRouter}from'react-router-dom';import Actions from ${JSON.stringify(erp + '/src/components/sales/CompanyDispatchDocumentActions')};
window.labCall=async(name,args=[])=>{const response=await fetch('/lab/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});const value=await response.json();if(!response.ok)throw Error(value.message);return value;};
async function boot(){window.labInput=await fetch('/lab/input').then(r=>r.json());const {config,item,ids,series}=window.labInput;const deny=()=>{throw Error('Esta navegación no forma parte del laboratorio');};function Lab(){const[cart,setCartState]=React.useState(()=>JSON.parse(localStorage.getItem('lab.cart.'+ids.company)||'[]')),setCart=React.useCallback(value=>setCartState(previous=>{const next=typeof value==='function'?value(previous):value;localStorage.setItem('lab.cart.'+ids.company,JSON.stringify(next));return next;}),[]),[products,setProducts]=React.useState([item]),[customer,setCustomer]=React.useState(null),[tickets,setTickets]=React.useState([]),[transactions,setTransactions]=React.useState([]),[state,setState]=React.useState(null);const refresh=()=>window.labCall('state').then(setState);React.useEffect(()=>{refresh();},[]);return <><details style={{padding:8,background:'#fff3cd',position:'fixed',bottom:8,left:8,zIndex:45,maxWidth:'92vw',maxHeight:'75vh',overflow:'auto'}}><summary style={{cursor:'pointer',fontWeight:700}}>Laboratorio: estado y despacho ERP</summary><aside>LAB LOCAL: autenticación, maestros y plataforma Android son adaptadores; SQLite y PostgreSQL reales. Sin proveedor/impresora/producción. <button onClick={async()=>{await window.labCall('flush');await refresh();}}>Enviar outbox al ERP</button><button onClick={refresh}>Consultar estado real</button><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:960}}>{JSON.stringify(state)}</pre><p>El cobro ERP usa su aplicador vigente; consultar estado y evidencia contable antes de considerarlo aplicado.</p>{state?.documents?.filter(d=>d.tipo_documento==='FACTURA').map(d=><div key={d.id}><strong>{d.codigo}</strong><Actions document={d} onChanged={refresh}/></div>)}</aside></details><POS config={config} currentUser={{id:ids.actor,name:'Operador sintético',role:'ADMIN',roleId:'ADMIN'}} roles={[{id:'ADMIN',name:'Laboratorio',permissions:['ALL']}]} users={[]} customers={[]} products={products} onUpdateProducts={setProducts} warehouses={[{id:ids.warehouse,name:'Almacén de laboratorio',isActive:true}]} cart={cart} onUpdateCart={setCart} selectedCustomer={customer} onSelectCustomer={setCustomer} parkedTickets={tickets} onUpdateParkedTickets={setTickets} transactions={transactions} zReports={[]} onLogout={deny} onOpenSettings={deny} onOpenAttendance={deny} onOpenCustomers={deny} onOpenHistory={deny} onOpenInvoiceActions={deny} onOpenFinance={deny} onOpenInventoryTracking={deny} onTransactionComplete={async tx=>{await window.labCall('appComplete',[tx]);setTransactions(previous=>[tx,...previous]);await refresh();}} onAddCustomer={deny} onUpdateConfig={deny} activeTerminalId={ids.terminal} internalSequences={[series]} v3Operational={{tariffId:ids.tariff,search:async()=>[item],resolveCode:async()=>null,validate:lines=>window.labCall('sessionValidate',[lines]),changeTariff:async()=>{throw Error('LAB_TARIFF_FIXED')}}}/></>;}createRoot(document.getElementById('root')).render(<BrowserRouter><Lab/></BrowserRouter>);}boot().catch(e=>{document.getElementById('root').textContent=e.stack});`;
const web = await build({ alias: { react: resolve(repo, 'node_modules/react'), 'react-dom': resolve(repo, 'node_modules/react-dom'), 'react-router-dom': resolve(erp, 'node_modules/react-router-dom') }, outdir: resolve(dir, 'web'), stdin: { contents: entry, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'explicit-lab-ports', setup(b) { b.onResolve({ filter: /.*/ }, a => { let key = /\/(settingsService|activeCompanyContext|usePermissions|accountingSetupService|documentSeriesResolution|supabaseClient)$/.test(a.path) ? a.path.split('/').pop() : a.path === '@capacitor/core' ? 'cap' : /\/services\/db$|^\.\.\/db$/.test(a.path) ? 'db' : /\/utils\/db$/.test(a.path) ? 'utilsDb' : /\/transactionService$/.test(a.path) ? 'transaction' : /\/CompanyDispatchRuntime$/.test(a.path) ? 'runtime' : /\/FiscalWorkflowV2Client$/.test(a.path) ? 'fiscal' : /\/NetworkSyncService$/.test(a.path) ? 'network' : /\/uberEatsPosService$/.test(a.path) ? 'uber' : /\/DurableOutboxRepository$/.test(a.path) ? 'outbox' : /\/SyncManager$/.test(a.path) ? 'syncManager' : null; return key ? { path: key, namespace: 'lab' } : undefined; }); b.onLoad({ filter: /.*/, namespace: 'lab' }, a => ({ contents: browserPorts[a.path], loader: 'js' })); } }] });
let queue = Promise.resolve();
const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) {
        res.writeHead(403).end();
        return;
    }
    try {
        if (req.url?.startsWith('/api/settings/')) {
            const url = new URL(req.url, 'http://127.0.0.1');
            let value;
            if (req.method === 'POST') {
                let raw = '';
                for await (const c of req)
                    raw += c;
                const { action, requestKey, companyId, ...body } = JSON.parse(raw);
                if (companyId !== ids.company)
                    throw Error('LAB_COMPANY_SCOPE');
                value = { result: await f.command(action, body, requestKey) };
            }
            else if (url.pathname.startsWith('/api/settings/company-dispatch/documents/')) {
                const result = await queryClient.rpc('erp_company_dispatch_document_v1', { p_scope: { tenantId: ids.tenant, companyId: ids.company }, p_actor: ids.actor, p_document: url.pathname.split('/').pop(), p_type: url.searchParams.get('documentType'), p_offset: Number(url.searchParams.get('offset') || 0) });
                if (result.error)
                    throw result.error;
                value = result.data;
            }
            else if (url.pathname === '/api/settings/warehouse-bins') {
                const tables: Record<string, string> = { locations: 'erp_warehouse_locations', stock: 'erp_warehouse_bin_stock_details', bins: 'erp_warehouse_bins_overview', preferences: 'erp_warehouse_bin_preferences' }, resource = url.searchParams.get('resource')!, table = tables[resource];
                if (!table || url.searchParams.get('warehouseId') !== ids.warehouse)
                    throw Error('LAB_WAREHOUSE_SCOPE');
                const values = [ids.tenant, ids.company, ids.warehouse], where = ['tenant_id=$1', 'company_id=$2', 'warehouse_id=$3'];
                for (const [param, column] of [['itemId', 'item_id'], ['locationId', resource === 'locations' ? 'id' : 'location_id'], ['binId', 'id']])
                    if (url.searchParams.get(param)) {
                        values.push(url.searchParams.get(param)!);
                        where.push(column + '=$' + values.length);
                    }
                const rows = (await f.db.query('select * from ' + table + ' where ' + where.join(' and ') + ' limit 50', values)).rows;
                value = { rows, total: rows.length, hasMore: false };
            }
            else
                throw Error('LAB_ROUTE_UNSUPPORTED');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(value));
            return;
        }
        if (req.url === '/lab/input') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(input));
            return;
        }
        if (req.url === '/lab.css') {
            res.setHeader('Content-Type', 'text/css');
            res.end(appCss + '\n' + web.outputFiles.filter(x => x.path.endsWith('.css')).map(x => x.text).join('\n'));
            return;
        }
        if (req.url === '/lab.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(web.outputFiles.find(x => x.path.endsWith('.js'))!.text);
            return;
        }
        if (req.url === '/lab/call' && req.method === 'POST') {
            let raw = '';
            for await (const c of req) {
                raw += c;
                if (raw.length > 2000000)
                    throw Error('Payload too large');
            }
            const { name, args } = JSON.parse(raw);
            if (!op[name] || !Array.isArray(args))
                throw Error('Unknown lab operation: ' + name);
            const run = queue.then(() => op[name](...args));
            queue = run.catch(() => { });
            const value = await run;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(value ?? null));
            return;
        }
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Despacho POS local</title><link rel="stylesheet" href="/lab.css"><style>[aria-labelledby=bin-allocation-title]{z-index:220}</style><body><div id="root"></div><script src="/lab.js"></script></body></html>');
    }
    catch (error) {
        console.error(error);
        res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: String((error as Error).message) }));
    }
});
server.listen(0, '127.0.0.1', () => console.log('LOCAL_SYNTHETIC_ONLY http://127.0.0.1:' + (server.address() as any).port + ' · own SQLite ' + dir));
let closing = false;
async function close() {
    if (closing)
        return;
    closing = true;
    server.close();
    await queue;
    n.db.close();
    await f.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
