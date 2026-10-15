import SQLite from 'better-sqlite3';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { ARTICLE_FORMAT_NETWORK_SCHEMA } from '../services/articleFormats/networkSchema';
import { ArticleFormatNetworkMaster } from '../services/articleFormats/networkMaster';
import { ArticleFormatPosting, saleWireLine, wireTotals } from '../services/articleFormats/posting';
import { canonicalContent } from '../services/articleFormats/store';
import { wireHash, type WireEvent, type FormatACK } from '../services/articleFormats/wire';
import { context, id } from './articleFormatsNetworkFixture';
export {context,id};
const base={schemaVersion:1 as const,id:'unit',variantId:null,name:'Unidad',abbreviation:'UN',factor:1,barcode:'',active:true,is_base:true,default_purchase:false,default_sale:false,allow_purchase:true,allow_sale:true,allow_transfer:true,sort_order:0,prices:[]};
export const dto={schema_version:1 as const,inventory_quantity_unit:'BASE' as const,item_id:id(7),formats:[base,{...base,id:'pack',factor:6,is_base:false,sort_order:1},{...base,id:'case',name:'Caja24',factor:24,is_base:false,sort_order:2,prices:[{tariffId:id(6),price:1080}]}]};
export const policy={item_id:id(7),base_unit_cost:'35',variant_ids:[],variant_skus:{},base_prices:[{variant_id:null,tariff_id:id(6),price:'45',tax_included:false}],taxes:[],tax_rate:'0',max_discount_rate:'10',promotions:[],warehouse_id:id(5)};
export const options={seriesId:id(9),userId:id(25),userName:'Synthetic'};
export function nativeSale(n=12,quantity='2'):WireEvent {
 const line=saleWireLine(dto,policy,{lineId:id(n+2),formatId:'case',variantId:null,tariffId:id(6),quantity,occurredAt:'2026-10-14T12:00:00-04:00',terminalId:id(4)});
 return {schema_version:1,event_id:id(n),transaction_id:id(n+1),event_type:'ARTICLE_FORMAT_SALE_V1',occurred_at:'2026-10-14T12:00:00-04:00',master:{sync_id:id(11),revision:1},fiscal:{mode:'NONE'},lines:[line],payments:[{payment_id:id(n+3),method:'cash',amount:wireTotals([line]).total_amount}],totals:wireTotals([line])};
}
export async function nativeACK(e:WireEvent):Promise<FormatACK>{return {schema_version:1,eventId:e.event_id,applied:true,disposition:'APPLIED',inbox_id:id(20),document_id:id(21),document_code:'F-1',inventory_movement_ids:[id(22)],accounting_entry_ids:[id(23)],payment_entry_id:id(24),inventory_quantity_unit:'BASE',content_hash:await wireHash(e),committed_at:'2026-10-14T17:00:00Z',...(e.return_context?{return_authorization:{...e.return_context,admission_grant_revision:e.return_context.grant_revision,admission_fingerprint:e.return_context.fingerprint,recovery_id:null}}:{})};}
export interface NativeFault {
 writes:number;queries:number;failWrite?:number;failQuery?:number;failBegin?:boolean;failBeforeCommit?:boolean;loseCommitResponse?:boolean;
 beforeRun?:(sql:string,values:any[])=>Promise<void>;
}
export async function nativeFixture(db=new SQLite(':memory:'),seed=true) {
 const fault:NativeFault={writes:0,queries:0};
 const bridge={
  execute:async(sql:string,transaction=true)=>{if(transaction)db.transaction(()=>db.exec(sql))();else db.exec(sql);return {changes:{changes:0}};},
  run:async(sql:string,values:any[]=[],_transaction=true)=>{
   await fault.beforeRun?.(sql,values);
   if(fault.writes++===fault.failWrite)throw Error('injected-write');
   const r=db.prepare(sql).run(...values);return {changes:{changes:r.changes,lastId:r.lastInsertRowid}};
  },
  query:async(sql:string,values:any[]=[])=>{if(fault.queries++===fault.failQuery)throw Error('injected-query');return {values:db.prepare(sql).all(...values)};},
  executeSet:async(entries:{statement:string;values:any[]}[])=>{db.transaction(()=>{for(const e of entries)db.prepare(e.statement).run(...e.values);})();return {changes:{changes:entries.length}};},
  beginTransaction:async()=>{if(fault.failBegin)throw Error('injected-begin');db.exec('BEGIN IMMEDIATE');return {changes:{changes:0}};},
  commitTransaction:async()=>{if(fault.failBeforeCommit)throw Error('injected-precommit');db.exec('COMMIT');if(fault.loseCommitResponse)throw Error('injected-commit-response');return {changes:{changes:0}};},
  rollbackTransaction:async()=>{db.exec('ROLLBACK');return {changes:{changes:0}};},
  isTransactionActive:async()=>({result:db.inTransaction}),
 };
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge});
 if(seed){
  await (adapter as any).initSchema();db.exec(ARTICLE_FORMAT_NETWORK_SCHEMA);
  const put=(name:string,doc:any)=>db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(name,doc.id,JSON.stringify(doc),0,'fixture');
  put('config',{id:'current',terminals:[{id:id(4),config:{erpTerminalId:id(4),currentDeviceId:id(50),erpBinding:{tenantId:id(1),companyId:id(2),storeId:id(3)},inventoryScope:{defaultSalesWarehouseId:id(5)}}}]});
  put('internalSequences',{id:id(9),documentType:'TICKET',prefix:'TCK-',padding:6,nextNumber:1});
  put('internalSequences',{id:id(10),documentType:'REFUND',prefix:'REF-',padding:6,nextNumber:1});
  put('globalSequenceCounter',{id:'value',count:0});
  const binding=JSON.stringify([id(1),id(4),id(50),'https://erp.invalid','https://erp.invalid']);
  db.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1').run(id(60),32);
  db.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run(id(60),32,binding);
  db.prepare('INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,?)').run(id(60),32,4,'inventory-cursor','fixture');
  db.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(id(7),id(5),137,0,0,'fixture');
  const article={id:id(7),name:'Synthetic',type:'PRODUCT',inventoriable:true,active:true,sellable:true,taxable:false,taxIds:[],variants:[],cost:35,operationalFlags:{trackInventory:true,allowNegativeStock:false}};
  db.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,taxable,tax_ids_json,active,sellable,record_json) VALUES(?,?,?,?,?,?,?)`).run(32,id(7),0,'[]',1,1,JSON.stringify(article));
  db.prepare(`INSERT INTO article_format_network_sessions(tenant_id,company_id,terminal_id,sync_id,revision,context,manifest,revision_checksum,state,completion_receipt) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id(1),id(2),id(4),id(11),1,canonicalContent(context),'{}','a'.repeat(64),'COMPLETE','{}');
  db.prepare('INSERT INTO article_format_network_active VALUES(?,?,?,?,?)').run(id(1),id(2),id(4),id(11),1);
  db.prepare('INSERT INTO article_format_network_policies VALUES(?,?,?,?,?,?,?)').run(id(1),id(2),id(4),id(11),id(7),canonicalContent(dto),canonicalContent(policy));
 }
 const sql=adapter.articleFormatFinancialSQL();
 const masters=new ArticleFormatNetworkMaster(sql,context,{request:async()=>{throw Error('network-in-local-unit-of-work');}});
 const posting=new ArticleFormatPosting(sql,context,masters);await posting.migrate();fault.writes=0;fault.queries=0;
 const documents=(name:string)=>(db.prepare('SELECT data FROM documents WHERE collection_name=? ORDER BY doc_id').all(name) as {data:string}[]).map(r=>JSON.parse(r.data));
 const state=()=>Object.fromEntries(['documents','article_format_outbox','article_format_wire_events','article_format_sale_lines','article_format_returns','article_format_base_movements','article_format_wire_write_scope'].map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
 const balance=async()=>137+await adapter.masterSyncV3Store.getLocalInventoryDelta(documents('inventoryLedger')[0]?.v3InventoryBaseline || '',id(7),id(5));
 return {db,adapter,posting,sql,masters,fault,documents,state,balance};
}
export function seedNativeFiscal(f:Awaited<ReturnType<typeof nativeFixture>>) {
 const range={id:id(100),type:'B02',prefix:'B02',startNumber:1,endNumber:20,currentGlobal:0,expiryDate:'2099-12-31',isActive:true};
 const allocation={id:id(101),terminalId:id(4),fiscalRangeId:range.id,ncfType:'B02',prefix:'B02',reservedStart:1,reservedEnd:20,nextNumber:2,status:'ACTIVE',releasedAt:null,metadata:{companyId:id(2)}};
 const buffer={id:'B02',type:'B02',prefix:'B02',currentNumber:1,startNumber:1,endNumber:1,expiryDate:range.expiryDate,terminalId:id(4),fiscalRangeId:range.id,allocationId:allocation.id};
 const put=(name:string,doc:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(name,doc.id,JSON.stringify(doc),0,'fixture');
 const config=f.documents('config')[0];config.companyInfo={rnc:'101010101'};config.terminals[0].config.fiscal={mode:'LEGACY_B',enabled:true,fiscalRanges:[range],fiscalAllocations:[allocation]};put('config',config);put('fiscalRanges',range);put('fiscalAllocations',allocation);put('localFiscalBuffer',buffer);
 const event=nativeSale();event.fiscal={mode:'LEGACY_B',ncf_type:'B02',ncf:'B0200000001'};
 return {range,allocation,buffer,config,event};
}
