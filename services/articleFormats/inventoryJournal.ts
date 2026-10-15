import type {FormatSQL,FormatStatement} from './store';
import {canonicalContent} from './store';
import {Money,requireFormat,validateContext,validateWireEvent,wireHash,type NetworkContext,type WireEvent,type FormatTransport} from './wire';
import {downloadInventoryReceipt,inventoryReceiptRequest,inventoryScope,same,signedBase4,type InventoryScope,type InventoryEffect,type InventoryManifest,type JournalOriginal} from './inventoryContract';

import {FORMAT_INVENTORY_SCHEMA} from './inventorySchema';
export {FORMAT_INVENTORY_SCHEMA} from './inventorySchema';
const fail=(value:unknown,code='POS_FORMAT_INVENTORY_CONTEXT_INCOMPLETE')=>requireFormat(value,code);
const generation=()=>globalThis.crypto.randomUUID();
const key=(s:InventoryScope)=>canonicalContent(inventoryScope(s));
const insert=(table:string,columns:string,values:(string|number|null)[]):FormatStatement=>({statement:`INSERT INTO ${table} (${columns}) VALUES(${values.map(()=>'?').join(',')})`,values});
function matchContext(scope:InventoryScope,context:NetworkContext){
 const s=context.scope;fail(scope.tenant_id===s.tenantId&&scope.company_id===s.companyId&&scope.store_id===s.storeId
  &&scope.terminal_id===s.terminalId&&scope.warehouse_id===s.warehouseId,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');
}
function validateHistoricalEffects(original:JournalOriginal,scope:InventoryScope){
 const event=original.event;fail(original.effects.length===event.lines.length);
 for(const line of event.lines){
  const policy=event.event_type==='ARTICLE_FORMAT_SALE_V1'?null:event.return_context?.return_policy;
  fail(event.event_type==='ARTICLE_FORMAT_SALE_V1'||policy);
  const delta=event.event_type==='ARTICLE_FORMAT_SALE_V1'?new Money(line.base_quantity).negated():policy==='RESTOCK'?new Money(line.base_quantity):new Money(0);
  const expected={event_id:event.event_id,line_id:line.line_id,item_id:line.item_id,variant_id:line.variant_id,warehouse_id:scope.warehouse_id,local_id:scope.local_id,delta_base:delta.toFixed(4),return_policy:policy};
  fail(same(original.effects.find(e=>e.line_id===line.line_id),expected),'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');
 }
 fail(new Set(original.effects.map(e=>e.line_id)).size===event.lines.length);
}
async function currentNativeContext(query:InventoryQuery,scope:InventoryScope){
 const tables=await query<any>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('documents','master_v3_operational_owner','article_format_network_active')",[]);
 fail(tables.length>=2,'POS_FORMAT_INVENTORY_NATIVE_STORAGE_REQUIRED');
 const configs=await query<any>("SELECT data FROM documents WHERE collection_name='config' AND doc_id='current'",[]);
 const config=configs[0]&&JSON.parse(configs[0].data),terminal=config?.terminals?.filter((t:any)=>(t.config?.erpTerminalId || t.id)===scope.terminal_id);
 fail(terminal?.length===1&&terminal[0].config?.currentDeviceId===scope.device_id&&terminal[0].config.erpBinding?.tenantId===scope.tenant_id
  &&terminal[0].config.erpBinding?.companyId===scope.company_id&&terminal[0].config.erpBinding?.storeId===scope.store_id
  &&terminal[0].config.inventoryScope?.defaultSalesWarehouseId===scope.warehouse_id,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');
 const owners=await query<any>('SELECT binding FROM master_v3_operational_owner WHERE singleton=1',[]);fail(owners.length===1);
 let identity:any;try{identity=JSON.parse(owners[0].binding);}catch{fail(false);}
 fail(identity?.[0]===scope.tenant_id&&identity?.[1]===scope.terminal_id&&identity?.[2]===scope.device_id,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');
 const admission=tables.some(t=>t.name==='article_format_network_active')?await query<any>(`SELECT s.context FROM article_format_network_active a JOIN article_format_network_sessions s
  USING(tenant_id,company_id,terminal_id,sync_id) WHERE a.tenant_id=? AND a.company_id=? AND a.terminal_id=?`,[scope.tenant_id,scope.company_id,scope.terminal_id]):[];
 const {lastHeartbeatAt:_heartbeat,lastSeenAt:_seen,...stableTerminal}=terminal[0];
 return canonicalContent({terminal:stableTerminal,binding:owners[0].binding,admission});
}
interface Binding {scope_key:string;authorization:string;reservations:string|null}
interface State {scope_key:string;generation:string;baseline_id:string|null;ordinal:string|null;receipt_id:string|null;checksum:string|null;manifest:string|null}
async function binding(sql:FormatSQL){return (await sql.query<Binding>('SELECT * FROM article_format_inventory_binding WHERE singleton=1',[]))[0];}
async function assertSelectedAuthority(query:InventoryQuery,state:State,b:Binding,contextToken:string){
 const rows=await query<{scope_key:string;baseline_id:string;context_token:string;authorization:string}>(
  'SELECT scope_key,baseline_id,context_token,authorization FROM article_format_inventory_authorities WHERE receipt_id=?',[state.receipt_id]);
 fail(rows.length===1,'POS_FORMAT_INVENTORY_AUTHORITY_UNPROVEN');const selected=rows[0];
 fail(selected.scope_key===b.scope_key&&selected.baseline_id===state.baseline_id&&selected.context_token===contextToken
  &&selected.authorization===b.authorization,'POS_FORMAT_INVENTORY_AUTHORITY_CHANGED');
}
export async function planInventoryOriginal(sql:FormatSQL,event:WireEvent,context:NetworkContext,hash:string):Promise<FormatStatement[]>{
 const b=await binding(sql);if(b)matchContext(JSON.parse(b.scope_key),context);
 const values=[context.scope.tenantId,context.scope.companyId,event.event_id];
 const statements:FormatStatement[]=[insert('article_format_inventory_originals','tenant_id,company_id,event_id,original,content_hash,context',[...values,canonicalContent(event),hash,canonicalContent(context)])];
 for(const line of event.lines){
  const policy=event.event_type==='ARTICLE_FORMAT_SALE_V1'?null:event.return_context?.return_policy;
  fail(event.event_type==='ARTICLE_FORMAT_SALE_V1'||policy,'POS_FORMAT_INVENTORY_CONTEXT_INCOMPLETE');
  const delta=event.event_type==='ARTICLE_FORMAT_SALE_V1'?new Money(line.base_quantity).negated():policy==='RESTOCK'?new Money(line.base_quantity):new Money(0);
  statements.push(insert('article_format_inventory_effects','tenant_id,company_id,event_id,line_id,item_id,variant_id,warehouse_id,delta_base,return_policy',
   [...values,line.line_id,line.item_id,line.variant_id,context.scope.warehouseId,delta.toFixed(4),policy || null]));
 }
 if(b){statements.push(insert('article_format_inventory_links','tenant_id,company_id,event_id,scope_key',[...values,b.scope_key]),
  {statement:'UPDATE article_format_inventory_state SET generation=? WHERE scope_key=?',values:[generation(),b.scope_key]});}
 return statements;
}
/** Fixture adapter never derives the expected local/device scope from an ERP receipt.
 * Production needs a separate trusted mapping integration before this can be wired to runtime. */
export interface InventoryFixtureBinding {scope:InventoryScope;authorization:string;reservationAuthority?:{baseline_id:string;quantities:Record<string,string>}}
export async function installInventoryFixtureBinding(sql:FormatSQL,input:InventoryFixtureBinding){
 const scope=key(input.scope);fail(typeof input.authorization==='string'&&input.authorization.length>0);
 for(const value of Object.values(input.reservationAuthority?.quantities || {}))fail(signedBase4(value).gte(0));
 fail(sql.runFinancial,'POS_FORMAT_ATOMIC_STORAGE_REQUIRED');
 await sql.runFinancial!(async tx=>tx.executeAtomic([
  {statement:'INSERT OR IGNORE INTO article_format_inventory_state(scope_key,generation) VALUES(?,?)',values:[scope,generation()]},
  {statement:'INSERT INTO article_format_inventory_binding VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET scope_key=excluded.scope_key,authorization=excluded.authorization,reservations=excluded.reservations',
   values:[scope,input.authorization,input.reservationAuthority?canonicalContent(input.reservationAuthority):null]}
 ]));
}
export class ArticleFormatInventoryJournal {
 constructor(private readonly sql:FormatSQL){fail(sql.runFinancial,'POS_FORMAT_ATOMIC_STORAGE_REQUIRED');}
 migrate(){return this.sql.executeSchema(FORMAT_INVENTORY_SCHEMA);}
 /** Retained ACKED and pending originals migrate together, or none. Historical scope evidence must be explicit; current binding is insufficient. */
 async bootstrapFixture(history:Record<string,InventoryScope>){
  await this.sql.runFinancial!(async tx=>{
   const b=await binding(tx);fail(b);const scope:InventoryScope=JSON.parse(b.scope_key);
   const rows=await tx.query<any>(`SELECT o.*,w.context,w.content_hash FROM article_format_outbox o LEFT JOIN article_format_wire_events w USING(tenant_id,company_id,event_id)
    WHERE o.tenant_id=? AND o.company_id=? AND o.terminal_id=?`,[scope.tenant_id,scope.company_id,scope.terminal_id]);
   const statements:FormatStatement[]=[];
   for(const row of rows){
    const old=await tx.query<any>('SELECT * FROM article_format_inventory_originals WHERE tenant_id=? AND company_id=? AND event_id=?',[row.tenant_id,row.company_id,row.event_id]);
    fail(row.context&&row.content_hash);const event=validateWireEvent(JSON.parse(row.content)),context=validateContext(JSON.parse(row.context));matchContext(scope,context);
    fail(await wireHash(event)===row.content_hash);fail(history[event.event_id]&&same(history[event.event_id],scope));
    const movements=await tx.query<any>('SELECT * FROM article_format_base_movements WHERE tenant_id=? AND company_id=? AND event_id=?',[row.tenant_id,row.company_id,row.event_id]);
    const planned=await planInventoryOriginal(tx,event,context,row.content_hash);
    fail(movements.length===event.lines.length);
    for(const line of event.lines){const m=movements.find(m=>m.line_id===line.line_id),p=planned.find(s=>s.statement.startsWith('INSERT INTO article_format_inventory_effects')&&s.values?.[3]===line.line_id);
     fail(m&&p&&m.item_id===line.item_id&&m.variant_key===JSON.stringify(line.variant_id)&&m.warehouse_id===scope.warehouse_id
      &&Number.isSafeInteger(m.base_delta)&&new Money(m.base_delta).div(10000).eq(p.values![7] as string));}
    if(!old.length)statements.push(...planned);else{
     fail(old.length===1&&old[0].original===canonicalContent(event)&&old[0].content_hash===row.content_hash&&old[0].context===row.context);
     const storedEffects=await tx.query<any>('SELECT * FROM article_format_inventory_effects WHERE tenant_id=? AND company_id=? AND event_id=?',[row.tenant_id,row.company_id,row.event_id]);
     validateHistoricalEffects({event,effects:storedEffects.map(e=>({event_id:e.event_id,line_id:e.line_id,item_id:e.item_id,variant_id:e.variant_id,warehouse_id:e.warehouse_id,local_id:scope.local_id,delta_base:e.delta_base,return_policy:e.return_policy}))},scope);
     const links=await tx.query<any>('SELECT * FROM article_format_inventory_links WHERE tenant_id=? AND company_id=? AND event_id=?',[row.tenant_id,row.company_id,row.event_id]);
     if(!links.length)statements.push(insert('article_format_inventory_links','tenant_id,company_id,event_id,scope_key',[row.tenant_id,row.company_id,row.event_id,b.scope_key]));
     else fail(links[0].scope_key===b.scope_key);
    }
   }
   if(statements.length)statements.push({statement:'UPDATE article_format_inventory_state SET generation=? WHERE scope_key=?',values:[generation(),b.scope_key]});
   await tx.executeAtomic(statements);
  });
 }
 captureFixture(){return this.sql.runFinancial!(tx=>this.capture(tx));}
 private async capture(tx:FormatSQL){
  const b=await binding(tx);fail(b,'POS_FORMAT_INVENTORY_TRUSTED_BINDING_REQUIRED');const scope:InventoryScope=inventoryScope(JSON.parse(b.scope_key));
  const contextToken=await currentNativeContext(tx.query,scope);
  const state=(await tx.query<State>('SELECT * FROM article_format_inventory_state WHERE scope_key=?',[b.scope_key]))[0];fail(state);
  // No financial state filter: ACKED events must remain until physical proof exists.
  const incomplete=await tx.query<any>(`SELECT o.event_id FROM article_format_outbox o LEFT JOIN article_format_wire_events w USING(tenant_id,company_id,event_id) LEFT JOIN article_format_inventory_originals j USING(tenant_id,company_id,event_id)
   LEFT JOIN article_format_inventory_links l USING(tenant_id,company_id,event_id) WHERE o.tenant_id=? AND o.company_id=? AND o.terminal_id=?
   AND (w.context IS NULL OR json_extract(w.context,'$.scope.warehouseId')=?)
   AND (j.event_id IS NULL OR l.scope_key IS NULL) LIMIT 1`,[scope.tenant_id,scope.company_id,scope.terminal_id,scope.warehouse_id]);fail(!incomplete.length);
  const rows=await tx.query<any>(`SELECT j.* FROM article_format_inventory_originals j JOIN article_format_inventory_links l USING(tenant_id,company_id,event_id)
   LEFT JOIN article_format_inventory_absorptions a ON a.scope_key=l.scope_key AND a.event_id=j.event_id
   WHERE l.scope_key=? AND a.event_id IS NULL ORDER BY j.event_id`,[b.scope_key]);
  const originals:JournalOriginal[]=[];
  for(const row of rows){
   const event=validateWireEvent(JSON.parse(row.original));matchContext(scope,validateContext(JSON.parse(row.context)));fail(await wireHash(event)===row.content_hash);
   const effects=await tx.query<any>('SELECT * FROM article_format_inventory_effects WHERE tenant_id=? AND company_id=? AND event_id=? ORDER BY line_id',[scope.tenant_id,scope.company_id,event.event_id]);
   fail(effects.length===event.lines.length);
   originals.push({event,effects:effects.map(e=>({event_id:e.event_id,line_id:e.line_id,item_id:e.item_id,variant_id:e.variant_id,warehouse_id:e.warehouse_id,
    local_id:scope.local_id,delta_base:e.delta_base,return_policy:e.return_policy}))});
  }
  originals.forEach(o=>validateHistoricalEffects(o,scope));
  inventoryReceiptRequest(state.generation,originals);await assertNoUnrepresentedEffects(tx.query,scope);
  return {b,state,scope,originals,contextToken};
 }
 async reconcileFixture(transport:FormatTransport){
  const capture=await this.captureFixture();
  const downloaded=await downloadInventoryReceipt(transport,capture.scope,capture.state.generation,capture.originals,async(manifest,page)=>{
   const index=page?.index ?? -1,content=canonicalContent(page || manifest);
   await this.sql.executeAtomic([{statement:`INSERT INTO article_format_inventory_staging VALUES(?,?,?) ON CONFLICT(receipt_id,page_index) DO UPDATE SET content=CASE WHEN content=excluded.content THEN content ELSE NULL END`,values:[manifest.receipt_id,index,content]}]);
  });
  return this.commitFixture(capture,downloaded);
 }
 async commitFixture(capture:Awaited<ReturnType<ArticleFormatInventoryJournal['captureFixture']>>,downloaded:Awaited<ReturnType<typeof downloadInventoryReceipt>>){
  const m=downloaded.manifest;
  const {validateManifest,validateInventoryRows,validateBaseline}=await import('./inventoryContract');
  await validateManifest(m,validateBaseline({...m,cut_kind:'MATERIALIZED_MVCC',snapshot_descriptor:'persisted'},capture.scope),capture.state.generation,capture.originals.map(o=>o.event.event_id),true);
  const validated=await validateInventoryRows(m,downloaded.pages,capture.originals);
  fail(same(validated.balances,downloaded.balances)&&same(validated.results,downloaded.results));
  return this.sql.runFinancial!(async tx=>{
   const current=await this.capture(tx);fail(current.b.scope_key===capture.b.scope_key&&current.b.authorization===capture.b.authorization
    &&current.contextToken===capture.contextToken,'POS_FORMAT_INVENTORY_CONTEXT_CHANGED');
   if(current.state.baseline_id===m.baseline_id){await assertSelectedAuthority(tx.query,current.state,current.b,current.contextToken);fail(current.state.manifest===canonicalContent(m),'POS_FORMAT_INVENTORY_REPLAY_CONFLICT');return {replayed:true,manifest:m};}
   fail(current.state.generation===capture.state.generation&&same(current.originals,capture.originals),'POS_FORMAT_INVENTORY_GENERATION_CHANGED');
   fail(!current.state.ordinal||BigInt(m.ordinal)>BigInt(current.state.ordinal),'POS_FORMAT_INVENTORY_ORDINAL_STALE');
   const statements:FormatStatement[]=[{statement:'DELETE FROM article_format_inventory_balances WHERE scope_key=?',values:[current.b.scope_key]}];
   for(const cell of downloaded.balances)statements.push(insert('article_format_inventory_balances','scope_key,item_id,warehouse_id,local_id,qty_physical,qty_committed',
    [current.b.scope_key,cell.item_id,cell.warehouse_id,cell.local_id,cell.qty_physical,cell.qty_committed]));
   for(const result of downloaded.results)if(result.status==='INCLUDED'||result.status==='NO_PHYSICAL_EFFECT')statements.push(insert('article_format_inventory_absorptions','scope_key,event_id,receipt_id,baseline_id,evidence',
    [current.b.scope_key,result.event_id,m.receipt_id,m.baseline_id,canonicalContent(result)]));
   statements.push(insert('article_format_inventory_authorities','receipt_id,scope_key,baseline_id,context_token,authorization',
    [m.receipt_id,current.b.scope_key,m.baseline_id,current.contextToken,current.b.authorization]),insert('article_format_inventory_history','receipt_id,scope_key,baseline_id,ordinal,manifest',[m.receipt_id,current.b.scope_key,m.baseline_id,m.ordinal,canonicalContent(m)]),
    {statement:'UPDATE article_format_inventory_state SET generation=?,baseline_id=?,ordinal=?,receipt_id=?,checksum=?,manifest=? WHERE scope_key=?',
     values:[generation(),m.baseline_id,m.ordinal,m.receipt_id,m.checksum,canonicalContent(m),current.b.scope_key]});
   await tx.executeAtomic(statements);return {replayed:false,manifest:m};
  });
 }
}
export type InventoryQuery=<T>(sql:string,values:(string|number|null)[])=>Promise<T[]>;
/** This contract cannot prove inclusion of nonformat or legacy local writers. */
export async function assertNoUnrepresentedEffects(query:InventoryQuery,scope:InventoryScope,itemIds?:string[]){
 const table=await query<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'",[]);
 fail(table.length,'POS_FORMAT_INVENTORY_NATIVE_STORAGE_REQUIRED');
 const params:(string|number|null)[]=[scope.warehouse_id];let itemFilter='';
 if(itemIds?.length){itemFilter=` AND json_extract(data,'$.productId') IN (${itemIds.map(()=>'?').join(',')})`;params.push(...itemIds);}
 const rows=await query<any>(`SELECT doc_id FROM documents d WHERE collection_name='inventoryLedger' AND json_extract(data,'$.warehouseId')=? ${itemFilter}
  AND (COALESCE(json_extract(data,'$.qtyIn'),0)<>0 OR COALESCE(json_extract(data,'$.qtyOut'),0)<>0)
  AND NOT EXISTS(SELECT 1 FROM article_format_inventory_effects e JOIN article_format_inventory_links l USING(tenant_id,company_id,event_id)
   WHERE l.scope_key=? AND e.event_id=json_extract(d.data,'$.articleFormatEventId') AND e.line_id=json_extract(d.data,'$.articleFormatLineId')
   AND d.doc_id=e.line_id AND e.item_id=json_extract(d.data,'$.productId') AND e.warehouse_id=json_extract(d.data,'$.warehouseId')
   AND e.delta_base=printf('%.4f',COALESCE(json_extract(d.data,'$.qtyIn'),0)-COALESCE(json_extract(d.data,'$.qtyOut'),0))) LIMIT 1`,[...params,key(scope)]);
 fail(!rows.length,'POS_FORMAT_INVENTORY_UNREPRESENTED_EFFECTS');
}
/** Ordinary writers have no physical inclusion proof in this format-only channel.
 * Run before native commit, including stock-exempt writers that still emit physical ledger rows. */
export async function assertNoReconciledOrdinaryWriter(query:InventoryQuery,warehouseId:string){
 let states:{scope_key:string}[];
 try{states=await query<{scope_key:string}>(`SELECT scope_key FROM article_format_inventory_state WHERE baseline_id IS NOT NULL
  AND json_extract(scope_key,'$.warehouse_id')=? LIMIT 1`,[warehouseId]);}
 catch(error){if(error instanceof Error&&/no such table: (?:main\.)?article_format_inventory_state(?:$|\s)/.test(error.message))return;throw error;}
 fail(!states.length,'POS_FORMAT_INVENTORY_UNSUPPORTED_WRITER');
}
/** Raw multi-query helper: callers must own the whole read under the native shared lock or runFinancial transaction.
 * Public native store proxies and financial readers provide that ownership; independently locked queries do not. */
export async function readReconciledPhysicalInventory(query:InventoryQuery,baseline:string,itemIds:string[],warehouseId:string){
 let states:State[];
 try{states=await query<State>('SELECT * FROM article_format_inventory_state WHERE baseline_id IS NOT NULL',[]);}
 catch(error){if(error instanceof Error&&/no such table: (?:main\.)?article_format_inventory_state(?:$|\s)/.test(error.message))return undefined;throw error;}
 if(!states.length)return undefined;
 const b=(await query<Binding>('SELECT * FROM article_format_inventory_binding WHERE singleton=1',[]))[0];fail(b,'POS_FORMAT_INVENTORY_TRUSTED_BINDING_REQUIRED');
 const state=states.find(s=>s.scope_key===b.scope_key);fail(state,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');const scope=inventoryScope(JSON.parse(b.scope_key));
 let identity:any;try{identity=JSON.parse(JSON.parse(baseline)[0]);}catch{fail(false,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');}
 fail(identity?.[0]===scope.tenant_id&&identity?.[1]===scope.terminal_id&&identity?.[2]===scope.device_id&&warehouseId===scope.warehouse_id,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');
 await assertSelectedAuthority(query,state,b,await currentNativeContext(query,scope));
 await assertNoUnrepresentedEffects(query,scope,itemIds);
 fail(itemIds.length<=100,'POS_FORMAT_INVENTORY_QUERY_LIMIT');if(!itemIds.length)return {};
 const placeholders=itemIds.map(()=>'?').join(',');
 const balances=await query<any>(`SELECT * FROM article_format_inventory_balances WHERE scope_key=? AND item_id IN (${placeholders})`,[b.scope_key,...itemIds]);
 const effects=await query<any>(`SELECT e.item_id,e.delta_base FROM article_format_inventory_effects e JOIN article_format_inventory_links l USING(tenant_id,company_id,event_id)
  LEFT JOIN article_format_inventory_absorptions a ON a.scope_key=l.scope_key AND a.event_id=e.event_id
  WHERE l.scope_key=? AND a.event_id IS NULL AND e.item_id IN (${placeholders})`,[b.scope_key,...itemIds]);
 const result:Record<string,{physical:InstanceType<typeof Money>;committed:InstanceType<typeof Money>}>={};
 for(const itemId of new Set(itemIds)){
  const rows=balances.filter(c=>c.item_id===itemId);fail(rows.length===1,'POS_FORMAT_STOCK_BASELINE_MISSING');const row=rows[0];
  let physical=signedBase4(row.qty_physical);for(const e of effects.filter(e=>e.item_id===itemId))physical=physical.plus(signedBase4(e.delta_base));
  fail(physical.abs().lte('99999999999.9999'),'POS_FORMAT_PRECISION_INVALID');const committed=signedBase4(row.qty_committed);
  result[itemId]={physical,committed};
 }
 return result;
}

export async function readReconciledInventory(query:InventoryQuery,baseline:string,itemIds:string[],warehouseId:string){
 const physical=await readReconciledPhysicalInventory(query,baseline,itemIds,warehouseId);if(!physical)return undefined;
 const b=(await query<Binding>('SELECT * FROM article_format_inventory_binding WHERE singleton=1',[]))[0];
 const state=(await query<State>('SELECT * FROM article_format_inventory_state WHERE scope_key=?',[b.scope_key]))[0];
 const reservation=b.reservations&&JSON.parse(b.reservations);
 const result:Record<string,{physical:InstanceType<typeof Money>;committed:InstanceType<typeof Money>;reserved:InstanceType<typeof Money>;available:InstanceType<typeof Money>}>={};
 for(const [itemId,stock] of Object.entries(physical)){
  // qty_reserved is absent from ERP v1. Never combine a new cut with stale V3 reservations.
  fail(reservation?.baseline_id===state.baseline_id&&Object.hasOwn(reservation.quantities,itemId),'POS_FORMAT_INVENTORY_RESERVATIONS_UNPROVEN');
  const reserved=signedBase4(reservation.quantities[itemId]);fail(reserved.gte(0));
  result[itemId]={...stock,reserved,available:stock.physical.minus(stock.committed).minus(reserved)};
 }
 return result;
}
