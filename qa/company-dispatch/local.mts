/** Loopback-only disposable laboratory. Real React modal, POS/App callbacks,
 * Native SQLite writer and ERP SQL; auth, device platform and masters are fixtures.
 * No operational bootstrap, credentials, .env, provider, printer or production IO. */
import { register } from 'node:module';
import { localPgClient } from './pg-client.mts';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import {gzipSync} from 'node:zlib';
import { build } from 'esbuild';
import ts from 'typescript';
import SQLite from 'better-sqlite3';
import { dispatchCommercialSource, dispatchPaymentIntents } from '../../services/db/CompanyDispatchEscrowStore';
import{assertNewFiscalIssuer,assertFiscalIssuance}from'../../utils/fiscalIssuance';
import{isTerminalFiscalReceiptRequired}from'../../utils/fiscal/fiscalHelpers';
import {financialIdentity} from '../../services/db/LargeMasterSyncV3FinancialRetention';
import { nativeFixture } from '../../tests/articleFormatsNativeFixture';
import { getInitialConfig } from '../../constants';
import { SubVertical } from '../../types';
const serviceLab=process.argv.includes('--service');const fiscalLab=process.argv.includes('--fiscal'),formatLab=process.argv.includes('--format'),trackedKind=process.argv.includes('--lot')?'LOT':process.argv.includes('--serial')?'SERIAL':null;
const repo = process.cwd(), erp = resolve(repo, '../CLIC-ERP-company-dispatch');
if (process.env.CLIC_DISPATCH_TEST_PG_PORT !== '55443')
    throw Error('Explicit isolated PG55443 required');
register('data:text/javascript,' + encodeURIComponent("export async function resolve(specifier,context,next){if(specifier.endsWith('/supabaseClient.js'))return {url:'data:text/javascript,'+encodeURIComponent('export default new Proxy({}, {get:(_t,k)=>(...args)=>globalThis.__dispatchLab.erpClient[k](...args)});'),shortCircuit:true};return next(specifier,context);}"));
const { createCompanyDispatchErpFlowFixture } = await import(erp + '/server/services/companyDispatch.erpFlow.fixture.js');
const receipts=trackedKind?(trackedKind==='LOT'?[{quantity:5,metadata:{lot_code:'LOT-A'},dimensions:{lotCode:'LOT-A'}},{quantity:5,metadata:{lot_code:'LOT-B'},dimensions:{lotCode:'LOT-B'}}]:Array.from({length:10},(_,i)=>({quantity:1,metadata:{serial_number:'SERIAL-'+(i+1)},dimensions:{serialNumber:'SERIAL-'+(i+1)}}))):null;
const f = await createCompanyDispatchErpFlowFixture({unspentFilter:false,openingReceipts:receipts});
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261107101743_company_store_dispatch_policy.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261107115547_pos_dispatch_cash_close.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261107121403_dispatch_stock_parts.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261107133003_dispatch_quota_assignment_reader.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261107135323_dispatch_direct_nostock_v3.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261107140714_dispatch_bin_stock_read_model.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261108130423_dispatch_unspent_active_quota_filter.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261108135851_dispatch_request_omni_memo.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261108143815_dispatch_memo_eligibility_aggregate.sql'),'utf8'));
await f.db.query(await readFile(resolve(erp,'supabase/migrations/20261108152830_dispatch_deferred_dimension_epochs.sql'),'utf8'));
if(process.argv.includes('--cash-close'))await f.db.query("update erp_companies set config=jsonb_set(config,'{accounting}',coalesce(config->'accounting','{}')||'{\"salesPostingMode\":\"CASH_CLOSE\"}'::jsonb) where id=$1",[f.ids.company]);
f.command=async(action:string,body:any={},key=randomUUID())=>{await f.db.query('set role service_role');try{return(await f.db.query('select erp_company_dispatch_command_v1($1,$2,$3,$4) result',[{tenantId:f.ids.tenant,companyId:f.ids.company,storeId:f.ids.store},f.ids.actor,key,{action,...body}])).rows[0].result;}finally{await f.db.query('reset role');}};
await f.db.query('update locales set mall_id=$1 where id=$2',[f.ids.store,f.ids.local]);
const dir = await mkdtemp(resolve(tmpdir(), 'clic-dispatch-ui-'));
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
if(serviceLab)await f.db.query("update items set type='SERVICE',metadata=metadata||'{\"isInventoriable\":false}'::jsonb where id=$1",[ids.item]);
const labFormat={schemaVersion:1,id:'BOX6',name:'Caja de seis',abbreviation:'CJ',factor:6,variantId:null,active:true,allowSale:true,prices:[]};
if(formatLab)await f.db.query("update items set metadata=metadata||jsonb_build_object('articleFormats',$2::jsonb) where id=$1",[ids.item,JSON.stringify([labFormat])]);
if(trackedKind)await f.db.query("update items set metadata=metadata||jsonb_build_object('operationalFlags',$2::jsonb) where id=$1",[ids.item,{usesLots:trackedKind==='LOT',usesSerial:trackedKind==='SERIAL'}]);
const trackedUnits:any[]=[];
if(trackedKind)for(const receipt of receipts!){const expected=(await f.db.query('select private.erp_tracking_stock_v1($1,$2,$3,$4) s',[ids.tenant,ids.company,ids.warehouse,ids.item])).rows[0].s;await f.db.query('set role service_role');try{const code=receipt.metadata.lot_code||receipt.metadata.serial_number;const unit=(await f.db.query('select erp_item_tracking_register_v1($1,$2,$3) r',[{tenantId:ids.tenant,companyId:ids.company,storeId:ids.store},ids.actor,{idempotencyKey:randomUUID(),warehouseId:ids.warehouse,itemId:ids.item,kind:trackedKind,code,quantityMinor:receipt.quantity*1000000,receivedAt:new Date(Date.now()-60000).toISOString(),expectedStock:expected,sourceEvidence:{kind:'EXISTING_STOCK_RECONCILIATION',id:'synthetic-receipt-'+code}}])).rows[0].r;trackedUnits.push({id:unit.id,code,quantity:receipt.quantity});}finally{await f.db.query('reset role');}}
if(fiscalLab){await f.db.query("update erp_companies set tax_id='101010101',legal_name='Synthetic issuer',config=config||'{\"fiscal\":{\"providerId\":\"MSELLER\",\"voucherModel\":\"ECF\"}}'::jsonb where id=$1",[ids.company]);await f.db.query("update erp_terminals set config=config||jsonb_build_object('fiscal',jsonb_build_object('providerId','MSELLER','enabled',true,'mode','ECF','environment',2,'credentialKey','101010101'),'runtime',jsonb_build_object('syncAuthToken','synthetic-lab-session'),'metadata',jsonb_build_object('binding_status','BOUND','binding_mode','MASTER'))where id=$1",[ids.terminal]);}
const no = () => { }, global = globalThis as any;
global.window = { dispatchEvent: no, setTimeout, clearTimeout };
const credentials={terminalId:ids.terminal,erpTerminalId:ids.terminal,tenantId:ids.tenant,erpTenantId:ids.tenant,companyId:ids.company,storeId:ids.store,deviceId:ids.device,deviceToken:'synthetic-lab-device',syncToken:'synthetic-lab-session',authStatus:'BOUND'};const storage=new Map([['pos_device_id',ids.device],['CLIC_POS_DEVICE_ID',ids.device],['clic_terminal_credentials_v1',JSON.stringify(credentials)]]);global.localStorage={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
const binding = JSON.stringify([ids.tenant, ids.terminal, ids.device, 'https://erp.invalid', 'https://erp.invalid']);
const config: any = getInitialConfig(SubVertical.SUPERMARKET);
Object.assign(config, { id: 'current', fiscalCompliance: { mode: 'NONE' }, currencies: [{ code: 'DOP', symbol: 'RD$', rate: 1, isBase: true, isEnabled: true }], paymentMethods: [{ id: 'cash', type: 'CASH', name: 'Efectivo', isEnabled: true }], integrations: [], taxes: [], tariffs: [{ id: ids.tariff, name: 'Precio de laboratorio', isActive: true }], terminals: [{ id: ids.terminal, config: { erpTerminalId: ids.terminal, currentDeviceId: ids.device, erpBinding: { tenantId: ids.tenant, companyId: ids.company, storeId: ids.store }, inventoryScope: { defaultSalesWarehouseId: ids.warehouse }, documentAssignments: { TICKET: ids.series } } }] });
let allocationAuthority:any;
if(fiscalLab){const rangeId=randomUUID(),allocationId=randomUUID();const range={id:rangeId,type:'E32',prefix:'E32',startNumber:1,endNumber:20,currentGlobal:0,expiryDate:'',isActive:true},allocation={id:allocationId,terminalId:ids.terminal,fiscalRangeId:rangeId,ncfType:'E32',prefix:'E32',reservedStart:1,reservedEnd:20,nextNumber:1,status:'ACTIVE',releasedAt:null};Object.assign(config,{fiscalCompliance:{mode:'ECF',defaultProvider:'MSELLER',providers:[{id:'MSELLER',enabled:true,environment:2,credentialKey:'101010101'}]},companyInfo:{name:'Synthetic issuer',rnc:'101010101'}});Object.assign(config.terminals[0].config,{isPrimaryNode:true,governedByMaster:false,syncConfig:{mode:'MASTER'},fiscal:{providerId:'MSELLER',mode:'ECF',enabled:true,environment:2,credentialKey:'101010101',fiscalRanges:[range],fiscalAllocations:[allocation]}});allocationAuthority={range,allocation};await f.db.query("insert into erp_fiscal_ranges(id,tenant_id,company_id,ncf_type,prefix,start_number,end_number,current_global,is_active)values($1,$2,$3,'E32','E32',1,20,0,true)",[rangeId,ids.tenant,ids.company]);await f.db.query("insert into erp_terminal_fiscal_allocations(id,tenant_id,company_id,store_id,terminal_id,fiscal_range_id,ncf_type,reserved_start,reserved_end,status,next_number)values($1,$2,$3,$4,$5,$6,'E32',1,20,'ACTIVE',1)",[allocationId,ids.tenant,ids.company,ids.store,ids.terminal,rangeId]);await f.db.query("insert into fiscal_provider_credentials(id,tenant_id,company_id,provider_id,company_key,environment,is_active,auth_token,updated_at,tipo_ingreso,unidad_bienes,unidad_servicios)values($1,$2,$3,'MSELLER','101010101',2,true,'synthetic-local-only',now(),'1','47','43')",[randomUUID(),ids.tenant,ids.company]);}
const put = (collection: string, doc: any) => n.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(collection, doc.id, JSON.stringify(doc), 0, 'synthetic');
put('config', config);if(fiscalLab){put('fiscalRanges',allocationAuthority.range);put('fiscalAllocations',allocationAuthority.allocation);}
put('internalSequences', { id: ids.series, documentType: 'TICKET', prefix: 'TCK-LAB-', padding: 6, nextNumber: 1 });
put('globalSequenceCounter', { id: 'value', count: 0 });
n.db.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1').run(ids.sync, 32);
n.db.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run(ids.sync, 32, binding);
n.db.prepare('INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,?)').run(ids.sync, 32, 4, 'lab-inventory', 'synthetic');
n.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)VALUES(?,32,3,2,'ACTIVE','{}','synthetic','synthetic')").run(ids.sync);
const product:any = { id: ids.item, name: 'Artículo sintético', type: 'PRODUCT', inventoriable: true, active: true, sellable: true, taxable: false, taxIds: [], variants: [], cost: 10, activeWarehouseIds: [ids.warehouse], operationalFlags: { trackInventory: true, allowNegativeStock: false } };
if(serviceLab){product.type='SERVICE';product.inventoriable=false;product.recipeDetails=[];}
if(trackedKind){Object.assign(product.operationalFlags,{usesLots:trackedKind==='LOT',usesSerial:trackedKind==='SERIAL'});Object.assign(product,{tracking_contract_version:1,tracking_authorities:[]});}
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
if(serviceLab){const {toV3Article,toV3Prices,toV3Tariff}=await import(erp+'/server/services/largeMasterSyncV3.js'),master=(await f.db.query('select * from items where id=$1',[ids.item])).rows[0],token=randomUUID();await f.db.query("insert into erp_sync_v3_sessions(id,sync_version,tenant_id,company_id,store_id,version_key,generation_token,requested_terminal_id) overriding system value values($1,32,$2,$3,$4,$5,$6,$7)",[ids.sync,ids.tenant,ids.company,ids.store,'synthetic-service-'+ids.sync,token,ids.terminal]);const datasets={articles:[toV3Article(master,{activeTaxes:[]})],prices:toV3Prices(master,new Set([ids.tariff])),tariffs:[toV3Tariff({id:ids.tariff,is_active:true,currency:'DOP',tax_included:false})]};for(const[dataset,records]of Object.entries(datasets)){const text=JSON.stringify({schemaVersion:3,syncId:ids.sync,dataset,chunkIndex:0,records}),start=dataset==='prices'?ids.item+'::'+ids.tariff:records[0].id;await f.db.query('select erp_sync_v3_put_chunk($1,$2,$3,0,$4,$5,$6,$7,$8,$8,$9)',[ids.sync,token,dataset,records.length,Buffer.byteLength(text),gzipSync(text).length,createHash('sha256').update(text).digest('hex'),start,text]);}await f.db.query("update erp_sync_v3_sessions set status='READY',ready_at=now()where id=$1",[ids.sync]);}
const store = n.adapter.masterSyncV3Store, runtime = await r.LargeMasterSyncV3Runtime.open(store);
global.__dispatchLab.session = new r.LargeMasterSyncV3OperationalSession({ runtime, inventoryVersion: 4, inventoryCursor: 'lab-inventory' }, binding, store, 'https://erp.invalid', global.__dispatchLab.identity);
const session = global.__dispatchLab.session;
// One service-role SQL operation at a time, matching the backend's configured
// PostgREST authority without leaking SET ROLE across concurrent fixture IO.
let queryQueue:Promise<unknown>=Promise.resolve();
const serviceDb={query:(...args:any[])=>{const operation=queryQueue.then(async()=>{await f.db.query('set role service_role');try{return await f.db.query(...args);}finally{await f.db.query('reset role');}});queryQueue=operation.catch(()=>{});return operation;}};
const queryClient=localPgClient(serviceDb);
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
if(!serviceLab)await f.command('issueQuota', { bindingId: current.bindingId, lines: trackedKind?trackedUnits.slice(0,trackedKind==='LOT'?2:4).map(u=>({itemId:ids.item,warehouseId:ids.warehouse,quantity:trackedKind==='LOT'?4:1,dimensions:{trackingUnitId:u.id,...(trackedKind==='LOT'?{lotCode:u.code}:{serialNumber:u.code})}})):(process.argv.includes('--split-quota')?[2,2]:formatLab?[4,4]:[4]).map(quantity=>({itemId:ids.item,warehouseId:ids.warehouse,quantity})) });
await sync();
console.log('REAL_POOL_INSTALLED', await n.adapter.readDispatchActivePoolState!());
let fiscalClient:any,fiscalWorker:any;let providerIssues=0;
if(fiscalLab){const {createOfflineFiscalAllocationService}=await import(erp+'/server/services/fiscal/posFiscalOfflineAllocationV2.js');const issued=await createOfflineFiscalAllocationService({client:queryClient,authenticate:async()=>({scope,issuerRnc:'101010101',environment:2,terminal:{config:{metadata:{binding_mode:'MASTER'}}}}),env:{POS_FISCAL_OFFLINE_ALLOCATION_V2_ENABLED:'true',POS_FISCAL_OFFLINE_ALLOCATION_COMPANY_IDS:ids.company,POS_FISCAL_OFFLINE_ALLOCATION_TERMINAL_IDS:ids.terminal}}).authority({body:{schemaVersion:2,operationId:randomUUID()}});const {offlineFiscalAuthorityFromConfig}=await import('../../services/fiscal/OfflineFiscalLeaseContext');const local=await offlineFiscalAuthorityFromConfig(config,credentials,ids.device);await n.adapter.fiscalWorkflowStore.saveAllocation(issued.authorization,local,issued.serverTime);const {createFiscalWorkflowV2Client}=await import('../../services/fiscal/FiscalWorkflowV2Client');fiscalClient=createFiscalWorkflowV2Client({readAuth:()=>({descriptor:scope,base:'https://erp.invalid',headers:{authorization:'Bearer synthetic-lab-session'},assertCurrent:no}),fetchImpl:async()=>{throw Error('LAB_OFFLINE_NO_HTTP');},readOfflineAuthority:()=>offlineFiscalAuthorityFromConfig(config,credentials,ids.device),store:()=>n.adapter.fiscalWorkflowStore,prepareDispatch:(input:any)=>n.adapter.prepareDispatchFiscalCheckout(input)});const {createPosFiscalWorkflowWorker}=await import(erp+'/server/services/fiscal/posFiscalWorkflowV2.js');fiscalWorker=createPosFiscalWorkflowWorker({client:queryClient,enabled:()=>true,provider:{prepare:async()=>({fingerprint:'b'.repeat(64),issue:async(request:any)=>{providerIssues++;return{ncf:request.transaction.ncf,issuerRnc:'101010101',environment:2,invoiceTotal:request.transaction.total,status:'PENDING'};},get:async(ncf:string)=>({ncf,issuerRnc:'101010101',environment:2,status:'PENDING'})})}});console.log('REAL_FISCAL_ALLOCATION_INSTALLED',await fiscalClient.offlineReadiness());}

// HTTP/browser layer follows below. No business fixture authority is seeded above.
function callback(file: string, name: string, bindings: Record<string, any>) {
    const source = ts.createSourceFile(file, requireText(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    let arrow: ts.Expression | undefined;
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name)
            arrow = node as unknown as ts.Expression;
        if(ts.isPropertyAssignment(node)&&node.name.getText(source)===name)arrow=node.initializer;
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
for (const file of ['App.tsx','utils/db.ts', erp + '/server/routes/syncInbox.js'])
    sources.set(file, await readFile(file, 'utf8'));
function requireText(file: string) { return sources.get(file)!; }
if(fiscalLab){global.__dispatchLab.db.assertFiscalIssuerAuthority=callback('utils/db.ts','assertPersistedFiscalIssuer',{dbAdapter:n.adapter,assertNewFiscalIssuer});global.__dispatchLab.db.assertFiscalTransactionAuthority=callback('utils/db.ts','assertFiscalTransactionAuthority',{assertFiscalIssuance,dbAdapter:n.adapter,db:global.__dispatchLab.db,isTerminalFiscalReceiptRequired});}
const { assertFormatsPostingClosed } = await import('../../services/articleFormats/activation');
const appComplete = callback('App.tsx', 'handleTransactionComplete', { dbAdapter:n.adapter,financialIdentity,assertFormatsPostingClosed, config, deviceId: ids.device, db: global.__dispatchLab.db, LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED: true, persistV3FinancialTransaction: r.persistV3FinancialTransaction, fiscalSinglePreparation: { commit: () => { throw Error('NO_FISCAL_NONE'); } }, readV3CompletedReservation: () => { throw Error('NO_RESERVATION_FIXTURE'); }, setTransactions: no, setCustomers: no, syncFiscalDocument: async () => { }, backgroundSyncManager: { triggerSync: async () => { } }, console });
const { normalizePosInboxEventPayload } = await import(erp + '/server/services/posSaleEventContract.js');
const { V3_PLAN_KEY } = await import(erp + '/server/services/fiscal/posFiscalV3Source.js');
const envelope = callback(erp + '/server/routes/syncInbox.js', 'buildPosEventEnvelope', { normalizePosInboxEventPayload, V3_PLAN_KEY });
const { applyCompanyDispatchSale } = await import(erp + '/server/services/companyDispatchApplication.js'), { buildPosSyncEventResult } = await import(erp + '/server/services/posSyncEventOutcome.js'), { attachDispatchAdoptionProofs } = await import(erp + '/server/services/companyDispatchAck.js');
global.__dispatchLab.erpClient = queryClient;
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
let failCloseProjection=process.argv.some(arg=>arg==='--fail-close-projection'||arg.startsWith('--fail-close-projection='));
let closeProjectionCallsBeforeFault=Number(process.argv.find(arg=>arg.startsWith('--fail-close-projection='))?.split('=')[1]||1);
const existingRpc=queryClient.rpc.bind(queryClient);
queryClient.rpc=async(name:string,args:any)=>{if(name==='erp_pos_dispatch_cash_close_project_v1'&&failCloseProjection&&--closeProjectionCallsBeforeFault===0){failCloseProjection=false;return{data:null,error:{message:'LAB_CLOSE_PROJECTION_FAULT'}};}return existingRpc(name,args);};
let closeInbox:string|undefined;
async function closeCash(){
 if(!closeInbox){const event=randomUUID();closeInbox=randomUUID();const closedAt=new Date().toISOString(),openedAt=new Date(Date.now()-3600000).toISOString();const payload={tenant_id:ids.tenant,company_id:ids.company,store_id:ids.store,terminal_id:ids.terminal,device_id:ids.device,summary:{report_id:event,sequence_number:'LAB-Z-1',base_currency:'DOP',transaction_count:1,opened_at:openedAt,closed_at:closedAt},report:{id:event,openedAt,closedAt,baseCurrency:'DOP',sequenceNumber:'LAB-Z-1'}};await f.db.query("insert into erp_sync_inbox(id,event_id,event_type,status,tenant_id,store_id,terminal_id,payload)values($1,$2,'CASH_CLOSE_POSTED','RECEIVED',$3,$4,$5,$6)",[closeInbox,event,ids.tenant,ids.store,ids.terminal,payload]);}
 return{application:await applySyncInboxEventById(closeInbox),state:await state()};
}
const op: Record<string, (...a: any[]) => any> = { sync, flush, state, closeCash, assertFiscalIssuerAuthority:(...args:any[])=>global.__dispatchLab.db.assertFiscalIssuerAuthority(...args),assertFiscalTransactionAuthority:(...args:any[])=>global.__dispatchLab.db.assertFiscalTransactionAuthority(...args), fiscalWorker:async()=>{if(!fiscalWorker)throw Error('LAB_FISCAL_DISABLED');return{round:await fiscalWorker.runRound(),health:fiscalWorker.health(),providerIssues,rows:(await f.db.query("select id,state,reason,dispatch_fence,ncf,document_id from erp_pos_fiscal_workflows_v2 where scope->>'companyId'=$1",[ids.company])).rows};}, replayPayments: async () => { const before = await state(), rows = (await f.db.query("select id from erp_sync_inbox where store_id=$1 and event_type='PAYMENT_POSTED' and status='APPLIED'", [ids.store])).rows; if (!rows.length)
        throw Error('PAYMENT_NOT_APPLIED'); const results = []; for (const row of rows)
        results.push(await applySyncInboxEventById(row.id)); const after = await state(); if (JSON.stringify(before) !== JSON.stringify(after))
        throw Error('PAYMENT_REPLAY_CHANGED_EFFECTS'); return { unchanged: true, results }; }, sessionValidate: (lines: any[]) => session.validate(config, lines, ids.tariff, ids.warehouse, 'SALE'), transactionCreate: (...a: any[]) => r.transactionService.createTransaction(...a), appComplete, sessionSearch: async () => [(await (await session.catalog(ids.tariff, ids.warehouse)).get(ids.item)).product], sessionResolve: async () => null };
if(fiscalLab)for(const method of ['prepareOfflineAuthority','checkoutFiscalStatus','localCheckoutForReceipt','localCheckout','cancelUnreconcilableAttempt','reserveOfflineCheckout','recordPayment','acknowledge','pendingCheckoutInfo','offlineReady','offlineReadiness','offlineStatus','allocationDraft','prefetch','retirementCandidate','available'])op['fiscal.'+method]=async(...args:any[])=>{if(method==='reserveOfflineCheckout'&&args[2]===null)args[2]=undefined;const value=await fiscalClient[method](...args);if(method==='recordPayment')return n.adapter.fiscalWorkflowStore.readCheckout(args[0].checkoutId);if(method==='allocationDraft')return{draft:value,checkout:await n.adapter.fiscalWorkflowStore.readCheckout(args[0].checkoutId)};return value;};
for (const name of ['getDocument', 'getCollection', 'saveDocument', 'readDispatchActivePoolState', 'readDispatchPendingCheckout', 'readDispatchCheckoutAuthority', 'prepareDispatchPrecharge', 'markDispatchEffectPossible', 'dispatchNativeSchemaHash', 'getTrackingOperationReceipt','getFiscalBufferAvailability','prepareDispatchFiscalCheckout'])
    op['adapter.' + name] = (...a: any[]) => (n.adapter as any)[name](...a);
const projected = await session.projectConfig(config), item = await session.withStock((await (await session.catalog(ids.tariff, ids.warehouse)).get(ids.item)).product, ids.warehouse);
const {resolveCompanyDispatchConfig}=await import(erp+'/server/services/companyDispatchConfig.js');projected.inventoryDispatch=resolveCompanyDispatchConfig((await f.db.query('select id,config from erp_companies where id=$1',[ids.company])).rows[0],{id:ids.store,company_id:ids.company});
Object.assign(config, projected);
config.terminals[0].config.inventoryDispatch = config.inventoryDispatch;
const input = { fiscalLab,config, item, ids, series: { id: ids.series, documentType: 'TICKET', prefix: 'TCK-LAB-', padding: 6, nextNumber: 1 } };
const cssFiles = (await readdir(resolve(repo, 'dist/assets')).catch(() => [])).filter(x => x.endsWith('.css'));
const appCss = (await Promise.all(cssFiles.map(x => readFile(resolve(repo, 'dist/assets', x), 'utf8')))).join('\n');
const browserPorts: Record<string, string> = {
    'settingsService': `export const settingsApi={get:async(path,options={})=>{const r=await fetch('/api'+path+'?'+new URLSearchParams(Object.entries(options.params||{}).filter(([,v])=>v!==undefined&&v!==null)));const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message),{response:{status:r.status,data}});return{data};},post:async(path,body)=>{const r=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message),{response:{status:r.status,data}});return{data};}};`,
    'activeCompanyContext': `export const ACTIVE_COMPANY_CHANGED_EVENT='lab-company-changed';export const resolveActiveCompanyId=async()=>window.labInput.ids.company;`,
    'usePermissions': `const can=(module,action)=>['SALES_INVOICES','SALES_WAYBILLS','INVENTORY_BIN_STOCK','INVENTORY_BIN_MOVEMENTS','ERP_SETTINGS'].includes(module)&&['VIEW','INSERT','UPDATE'].includes(action);export const usePermissions=()=>({can});`,
    'accountingSetupService': `export default{loadSetup:async()=>({context:{tenantId:window.labInput.ids.tenant,companyId:window.labInput.ids.company}})};`,
    'documentSeriesResolution': `export const reserveNextErpWebSalesDocumentCode=async()=>({codigo:'CON-LAB-'+crypto.randomUUID().slice(0,8),seriesId:null});`,
    'supabaseClient': `export const supabase={};`,
    'db': `const call=(name,args)=>window.labCall('adapter.'+name,args);export const dbAdapter=new Proxy({isNative:true,inventoryPresentationsSQL:undefined},{get:(t,k)=>k in t?t[k]:(...args)=>call(k,args)});`,
    'utilsDb': `export const db={get:n=>window.labCall('adapter.getCollection',[n]),getDocument:(...a)=>window.labCall('adapter.getDocument',a),saveDocument:(...a)=>window.labCall('adapter.saveDocument',a),assertFiscalIssuerAuthority:(...a)=>window.labCall('assertFiscalIssuerAuthority',a),assertFiscalTransactionAuthority:(...a)=>window.labCall('assertFiscalTransactionAuthority',a),getConfig:async()=>window.labInput.config};`,
    'transaction': `export const transactionService={createTransaction:(...a)=>window.labCall('transactionCreate',a)};`,
    'runtime': `export const synchronizeNativeCompanyDispatch=()=>window.labCall('sync',[]);`,
    'fiscal': fiscalLab?`const call=(name,args)=>window.labCall('fiscal.'+name,args);export const verifyFiscalWorkflowState=()=>{throw Error('LAB_STATUS_VERIFICATION_NOT_EXERCISED')};export const fiscalWorkflowV2Client=new Proxy({enabled:()=>false,capability:()=>null,subscribe:()=>()=>{},recordPayment:async(checkout,id)=>{Object.assign(checkout,await call('recordPayment',[checkout,id]));},allocationDraft:async checkout=>{const value=await call('allocationDraft',[checkout]);Object.assign(checkout,value.checkout);return value.draft;}},{get:(t,k)=>k in t?t[k]:(...args)=>call(k,args)});`:`export const verifyFiscalWorkflowState=()=>{throw Error('LAB_FISCAL_DISABLED')};export const fiscalWorkflowV2Client={enabled:()=>false,offlineReady:async()=>false,pendingCheckoutInfo:async()=>null,retirementCandidate:async()=>null,capability:()=>null,subscribe:()=>()=>{},prefetch:async()=>null,offlineReadiness:async()=>({ready:false}),offlineStatus:async()=>({ready:false,remaining:0,remainingByType:{}}),available:async()=>0};`,
    'network': `export const networkSyncService={getStatus:()=>({isOnline:false,isMaster:true}),subscribe:()=>()=>{},getDeviceId:()=>window.labInput.ids.device};`,
    'cap': `export const buildRequestInit=()=>{throw Error('NO_EXTERNAL_HTTP')};export class WebPlugin{};export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>false};export const CapacitorHttp={request:async()=>{throw Error('NO_EXTERNAL_HTTP')}};export const registerPlugin=name=>new Proxy({},{get:()=>async()=>{throw Error('LAB_NATIVE_PLUGIN_UNSUPPORTED:'+name)}});`,
    'outbox': `export const durableOutboxRepository={isSupported:()=>true};`,
    'uber': `export const resolveUberEatsPosContext=()=>null;export const fetchUberEatsPendingOrders=async()=>[];export const fetchUberEatsOrderDraft=async()=>{throw Error('LAB_NO_UBER')};export const confirmUberEatsPosInvoice=async()=>{throw Error('LAB_NO_UBER')};`,
    'syncManager': `export const syncManager={broadcastChange:async()=>{},subscribe:()=>()=>{}};`,
};
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import POS from './components/POSInterface';import{BrowserRouter}from'react-router-dom';import Actions from ${JSON.stringify(erp + '/src/components/sales/CompanyDispatchDocumentActions')};import PolicyPanel from ${JSON.stringify(erp + '/src/components/settings/CompanyDispatchPolicyPanel')};
window.labCall=async(name,args=[])=>{const response=await fetch('/lab/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});const value=await response.json();if(!response.ok)throw Error(value.message);return value;};
async function boot(){window.labInput=await fetch('/lab/input').then(r=>r.json());const {config,item,ids,series}=window.labInput;if(window.labInput.fiscalLab){localStorage.setItem('CLIC_POS_DEVICE_ID',ids.device);localStorage.setItem('pos_device_id',ids.device);localStorage.setItem('clic_terminal_credentials_v1',JSON.stringify({terminalId:ids.terminal,erpTerminalId:ids.terminal,tenantId:ids.tenant,erpTenantId:ids.tenant,companyId:ids.company,storeId:ids.store,deviceId:ids.device,deviceToken:'synthetic-lab-device',syncToken:'synthetic-lab-session',authStatus:'BOUND'}));}const deny=()=>{throw Error('Esta navegación no forma parte del laboratorio');};const operational={tariffId:ids.tariff,search:async()=>[item],resolveCode:async()=>null,validate:lines=>window.labCall('sessionValidate',[lines]),changeTariff:async()=>{throw Error('LAB_TARIFF_FIXED')}};function Lab(){const[cart,setCartState]=React.useState(()=>JSON.parse(localStorage.getItem('lab.cart.'+ids.company)||'[]')),setCart=React.useCallback(value=>setCartState(previous=>{const next=typeof value==='function'?value(previous):value;localStorage.setItem('lab.cart.'+ids.company,JSON.stringify(next));return next;}),[]),[products,setProducts]=React.useState([item]),[customer,setCustomer]=React.useState(null),[tickets,setTickets]=React.useState([]),[transactions,setTransactions]=React.useState([]),[state,setState]=React.useState(null);const refresh=()=>window.labCall('state').then(setState);React.useEffect(()=>{refresh();},[]);if(location.search.includes('assignment'))return <main style={{padding:20}}><p>LAB: identidades y maestros sintéticos; lector/asignación SQL reales. No producción.</p><PolicyPanel companyId={ids.company} branches={[{id:ids.store,name:'Sucursal de laboratorio',company_id:ids.company}]}/></main>;return <><details style={{padding:8,background:'#fff3cd',position:'fixed',bottom:8,left:8,zIndex:45,maxWidth:'92vw',maxHeight:'75vh',overflow:'auto'}}><summary style={{cursor:'pointer',fontWeight:700}}>Laboratorio: estado y despacho ERP</summary><aside>LAB LOCAL: autenticación, maestros y plataforma Android son adaptadores; SQLite y PostgreSQL reales. Sin proveedor/impresora/producción. <button onClick={async()=>{await window.labCall('flush');await refresh();}}>Enviar outbox al ERP</button><button onClick={refresh}>Consultar estado real</button><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:960}}>{JSON.stringify(state)}</pre><p>El cobro ERP usa su aplicador vigente; consultar estado y evidencia contable antes de considerarlo aplicado.</p>{state?.documents?.filter(d=>d.tipo_documento==='FACTURA').map(d=><div key={d.id}><strong>{d.codigo}</strong><Actions document={d} onChanged={refresh}/></div>)}</aside></details><POS config={config} currentUser={{id:ids.actor,name:'Operador sintético',role:'ADMIN',roleId:'ADMIN'}} roles={[{id:'ADMIN',name:'Laboratorio',permissions:['ALL']}]} users={[]} customers={[]} products={products} onUpdateProducts={setProducts} warehouses={[{id:ids.warehouse,name:'Almacén de laboratorio',isActive:true}]} cart={cart} onUpdateCart={setCart} selectedCustomer={customer} onSelectCustomer={setCustomer} parkedTickets={tickets} onUpdateParkedTickets={setTickets} transactions={transactions} zReports={[]} onLogout={deny} onOpenSettings={deny} onOpenAttendance={deny} onOpenCustomers={deny} onOpenHistory={deny} onOpenInvoiceActions={deny} onOpenFinance={deny} onOpenInventoryTracking={deny} onTransactionComplete={async tx=>{await window.labCall('appComplete',[tx]);setTransactions(previous=>[tx,...previous]);await refresh();}} onAddCustomer={deny} onUpdateConfig={deny} activeTerminalId={ids.terminal} internalSequences={[series]} v3Operational={operational}/></>;}createRoot(document.getElementById('root')).render(<BrowserRouter><Lab/></BrowserRouter>);}boot().catch(e=>{document.getElementById('root').textContent=e.stack});`;
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
                const { action, requestKey, companyId, storeId, ...body } = JSON.parse(raw);
                if(storeId&&storeId!==ids.store)throw Error('LAB_STORE_SCOPE');
                if (companyId !== ids.company)
                    throw Error('LAB_COMPANY_SCOPE');
                value = { result: await f.command(action, body, requestKey) };
            }
            else if(url.pathname==='/api/settings/company-dispatch/assignment-options'){
                const result=await queryClient.rpc('erp_dispatch_assignment_options_v1',{p_scope:{tenantId:ids.tenant,companyId:ids.company,storeId:ids.store},p_actor:ids.actor,p_search:url.searchParams.get('search')||'',p_warehouse:url.searchParams.get('warehouseId'),p_item:url.searchParams.get('itemId')});if(result.error)throw result.error;value=result.data;
            }
            else if(url.pathname==='/api/settings/company-dispatch'){
                const result=await queryClient.rpc('erp_company_dispatch_status_v1',{p_scope:{tenantId:ids.tenant,companyId:ids.company,storeId:ids.store},p_actor:ids.actor,p_module:'ERP_SETTINGS'});if(result.error)throw result.error;value=result.data;
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
