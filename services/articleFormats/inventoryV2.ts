import {canonicalContent,type FormatSQL,type FormatStatement} from './store';
import {Money,hashText,requireFormat,uuid,type FormatTransport} from './wire';
import {signedBase4} from './inventoryContract';
import {readNativeFormatAuthority} from './nativeV3Financial';
import {cloneFormatJSON} from './json';
import {validateContextV2,type NetworkContextV2} from './v2';
export const INVENTORY_V2_SCHEMA=`
CREATE TABLE IF NOT EXISTS article_format_inventory_v2_generation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL);
INSERT OR IGNORE INTO article_format_inventory_v2_generation VALUES(1,0);
CREATE TABLE IF NOT EXISTS article_format_inventory_v2_authority(singleton INTEGER PRIMARY KEY CHECK(singleton=1),authority_hash TEXT NOT NULL,scope TEXT NOT NULL,expires_at TEXT NOT NULL,native_baseline TEXT NOT NULL,manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS article_format_inventory_v2_cells(item_id TEXT PRIMARY KEY,content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS article_format_inventory_v2_absorbed(ledger_id TEXT PRIMARY KEY,content_hash TEXT NOT NULL,receipt_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS article_format_inventory_v2_history(receipt_id TEXT PRIMARY KEY,manifest TEXT NOT NULL);
${['INSERT','UPDATE','DELETE'].map(op=>`CREATE TRIGGER IF NOT EXISTS article_format_inventory_v2_generation_${op.toLowerCase()} AFTER ${op} ON documents WHEN ${op==='INSERT'?'NEW':'OLD'}.collection_name IN ('inventoryLedger','inventoryCommitments','reservations') BEGIN UPDATE article_format_inventory_v2_generation SET generation=generation+1 WHERE singleton=1;END;`).join('\n')}
CREATE TRIGGER IF NOT EXISTS article_format_inventory_v2_source_update AFTER UPDATE OF payload_json,event_id,event_type ON sync_outbox_v2 WHEN (OLD.event_type='SALE_POSTED' OR NEW.event_type='SALE_POSTED') AND (OLD.payload_json<>NEW.payload_json OR OLD.event_id<>NEW.event_id OR OLD.event_type<>NEW.event_type) BEGIN UPDATE article_format_inventory_v2_generation SET generation=generation+1 WHERE singleton=1;END;
CREATE TRIGGER IF NOT EXISTS article_format_inventory_v2_source_insert AFTER INSERT ON sync_outbox_v2 WHEN NEW.event_type='SALE_POSTED' BEGIN UPDATE article_format_inventory_v2_generation SET generation=generation+1 WHERE singleton=1;END;
CREATE TRIGGER IF NOT EXISTS article_format_inventory_v2_source_delete AFTER DELETE ON sync_outbox_v2 WHEN OLD.event_type='SALE_POSTED' BEGIN UPDATE article_format_inventory_v2_generation SET generation=generation+1 WHERE singleton=1;END;
CREATE TRIGGER IF NOT EXISTS article_format_inventory_v2_history_update BEFORE UPDATE ON article_format_inventory_v2_history BEGIN SELECT RAISE(ABORT,'POS_FORMAT_INVENTORY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS article_format_inventory_v2_history_delete BEFORE DELETE ON article_format_inventory_v2_history BEGIN SELECT RAISE(ABORT,'POS_FORMAT_INVENTORY_IMMUTABLE');END;
`;
interface Original {source_kind:'ARTICLE_FORMAT_V1'|'ARTICLE_FORMAT_V2'|'ORDINARY_V3';event_id:string;original:Record<string,any>}
interface Ledger {id:string;productId:string;warehouseId:string;qtyIn:number;qtyOut:number;v3Binding:string;articleFormatEventId?:string;articleFormatLineId?:string;documentRef:string}
interface Capture {context:NetworkContextV2;generation:string;nativeBaseline:string;originals:Original[];ledger:Ledger[];ledgerHash:string}
// Only a complete, unchanged capture/download produced by this pipeline may select authority.
const captureSeals=new WeakMap<object,string>(),downloadSeals=new WeakMap<object,string>();
function sealed<T extends object>(value:T,seals:WeakMap<object,string>):T{requireFormat(seals.get(value)===canonicalContent(value),'POS_FORMAT_INVENTORY_STAGING_CHANGED');return cloneFormatJSON(value);}
const same=(a:unknown,b:unknown)=>canonicalContent(a)===canonicalContent(b);
const sourceScope=(c:NetworkContextV2)=>({tenant_id:c.scope.tenantId,company_id:c.scope.companyId,store_id:c.scope.storeId,terminal_id:c.scope.terminalId,device_id:c.scope.deviceId,warehouse_id:c.scope.warehouseId,local_id:c.scope.localId});
const generation=async(sql:FormatSQL)=>String((await sql.query<{generation:number}>('SELECT generation FROM article_format_inventory_v2_generation WHERE singleton=1',[]))[0]?.generation??'');
async function localLedger(sql:FormatSQL,c:NetworkContextV2):Promise<Ledger[]>{
 const rows=await sql.query<{data:string}>(`SELECT data FROM documents WHERE collection_name='inventoryLedger' AND json_extract(data,'$.warehouseId')=? ORDER BY doc_id`,[c.scope.warehouseId]);
 requireFormat(rows.length<=10000,'POS_FORMAT_INVENTORY_BACKLOG_LIMIT');
 const ledger=rows.map(r=>JSON.parse(r.data));
 for(const l of ledger){const binding=JSON.parse(l.v3Binding||'null');requireFormat(binding?.[0]===c.scope.tenantId&&binding?.[1]===c.scope.terminalId&&binding?.[2]===c.scope.deviceId,'POS_FORMAT_INVENTORY_UNREPRESENTED_EFFECT');for(const key of ['qtyIn','qtyOut']){requireFormat(typeof l[key]==='number'&&Number.isFinite(l[key])&&l[key]>=0,'POS_FORMAT_PRECISION_INVALID');signedBase4(new Money(l[key]).toFixed(4));requireFormat(new Money(l[key]).dp()<=4,'POS_FORMAT_PRECISION_INVALID');}}
 return ledger;
}
async function assertLocalCommitments(sql:FormatSQL,c:NetworkContextV2){
 const rows=await sql.query<{data:string}>(`SELECT data FROM documents WHERE collection_name='inventoryCommitments' AND json_extract(data,'$.warehouseId')=?`,[c.scope.warehouseId]);
 // Aggregate-only legacy commitments do not expose provenance. Never guess disjunction from their total.
 for(const r of rows){const v=JSON.parse(r.data);requireFormat(v.qtyCommitted===0,'POS_FORMAT_INVENTORY_LOCAL_COMMITMENT_PROVENANCE_REQUIRED');}
}
export async function captureInventoryV2(sql:FormatSQL,input:NetworkContextV2):Promise<Capture>{
 const c=validateContextV2(input);requireFormat(sql.runFinancial,'POS_FORMAT_ATOMIC_STORAGE_REQUIRED');
 return sql.runFinancial!(async tx=>{
  const authority=await readNativeFormatAuthority(tx,c);await assertLocalCommitments(tx,c);const ledger=await localLedger(tx,c),originals:Original[]=[];
  const formats=await tx.query<{original:string;context:string}>(`SELECT original,context FROM article_format_inventory_originals WHERE tenant_id=? AND company_id=? ORDER BY event_id`,[c.scope.tenantId,c.scope.companyId]);
  for(const row of formats){const ctx=JSON.parse(row.context),e=JSON.parse(row.original);if(ctx.scope.terminalId===c.scope.terminalId&&ctx.scope.warehouseId===c.scope.warehouseId)originals.push({source_kind:e.schema_version===2?'ARTICLE_FORMAT_V2':'ARTICLE_FORMAT_V1',event_id:e.event_id,original:e});}
  const ordinary=await tx.query<{event_id:string;payload_json:string}>(`SELECT event_id,payload_json FROM sync_outbox_v2 WHERE event_type='SALE_POSTED' ORDER BY local_sequence`,[]);
  for(const row of ordinary){const p=JSON.parse(row.payload_json);if(p.tenant_id===c.scope.tenantId&&p.terminal_id===c.scope.terminalId&&p.transaction?.v3WarehouseId===c.scope.warehouseId){requireFormat(p.company_id===c.scope.companyId&&p.store_id===c.scope.storeId&&p.device_id===c.scope.deviceId,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');originals.push({source_kind:'ORDINARY_V3',event_id:row.event_id,original:p});}}
  requireFormat(originals.length<=200&&new Set(originals.map(o=>o.event_id)).size===originals.length,'POS_FORMAT_INVENTORY_BACKLOG_LIMIT');
  for(const l of ledger){requireFormat(originals.some(o=>l.articleFormatEventId?o.event_id===l.articleFormatEventId:o.source_kind==='ORDINARY_V3'&&o.original.transaction?.id===l.documentRef),'POS_FORMAT_INVENTORY_UNREPRESENTED_EFFECT');}
  const captured={context:c,generation:await generation(tx),nativeBaseline:authority.baseline,originals,ledger,ledgerHash:await hashText(canonicalContent(ledger))};captureSeals.set(captured,canonicalContent(captured));return captured;
 });
}
function validCell(cell:any,c:NetworkContextV2){
 uuid(cell.item_id);requireFormat(cell.kind==='BALANCE'&&cell.warehouse_id===c.scope.warehouseId&&cell.local_id===c.scope.localId&&cell.source==='ERP_STOCK_AND_OMNICHANNEL_V1'&&cell.source_version===1&&/^[a-f0-9]{64}$/.test(cell.source_hash),'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
 const physical=signedBase4(cell.qty_physical),committed=signedBase4(cell.qty_committed),reserved=signedBase4(cell.qty_reserved);
 requireFormat(committed.gte(0)&&reserved.gte(0)&&(committed.eq(0)||reserved.eq(0))&&cell.disjunction==='TRIVIAL_ZERO_OPERAND','POS_FORMAT_INVENTORY_RESERVATIONS_UNPROVEN');return {physical,committed,reserved};
}
/** Download all immutable pages. Staging is inert; only install below changes a selected authority. */
export async function downloadInventoryV2(transport:FormatTransport,capture:Capture){
 capture=sealed(capture,captureSeals);
 const c=capture.context,prefix='/api/sync/article-formats/v2',body={schema_version:2,journal_generation:capture.generation,events:capture.originals};
 requireFormat(new TextEncoder().encode(JSON.stringify(body)).length<=8*1024*1024,'POS_FORMAT_INVENTORY_BACKLOG_LIMIT');
 const b=await transport.request(`${prefix}/inventory-baselines`,{});uuid(b.baseline_id);
 requireFormat(b.schema_version===2&&b.authority_hash===c.authority_hash&&same(b.scope,sourceScope(c))&&b.cut_kind==='MATERIALIZED_MVCC'&&/^[1-9]\d*$/.test(b.ordinal)&&b.balance_grain==='ITEM_LOCAL_AGGREGATE'&&b.quantity_scale===4&&Number.isInteger(b.balance_count)&&b.balance_count>=0&&b.balance_count<=50000,'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
 const m=await transport.request(`${prefix}/inventory-baselines/${b.baseline_id}/receipts`,body);uuid(m.receipt_id);
 requireFormat(m.schema_version===2&&m.baseline_id===b.baseline_id&&m.ordinal===b.ordinal&&m.authority_hash===c.authority_hash&&same(m.scope,b.scope)&&m.journal_generation===capture.generation&&m.complete===false&&m.balance_count===b.balance_count&&m.event_count===capture.originals.length&&m.row_count===m.balance_count+m.event_count&&m.page_size===100&&m.page_count===Math.max(1,Math.ceil(m.row_count/100))&&m.page_count<=502&&Array.isArray(m.pages)&&m.pages.length===m.page_count&&same([...m.requested_event_ids].sort(),capture.originals.map(o=>o.event_id).sort()),'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
 requireFormat(await hashText(m.pages.map((p:any)=>p.checksum).join(''))===m.checksum,'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
 const rows:any[]=[];let bytes=0;
 for(let index=0;index<m.page_count;index++){
  const page=await transport.request(`${prefix}/inventory-receipts/${m.receipt_id}/pages/${index}`),expected=m.pages[index];
  requireFormat(expected.index===index&&page.schema_version===2&&page.receipt_id===m.receipt_id&&page.baseline_id===b.baseline_id&&page.index===index&&page.next_index===(index+1<m.page_count?index+1:null)&&page.row_count===expected.row_count&&page.checksum===expected.checksum&&Array.isArray(page.rows)&&page.rows.length===expected.row_count&&same(JSON.parse(page.canonical_payload_text),page.rows)&&await hashText(page.canonical_payload_text)===expected.checksum,'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
  bytes+=new TextEncoder().encode(page.canonical_payload_text).length;requireFormat(bytes<=64*1024*1024,'POS_FORMAT_INVENTORY_SOURCE_INCOMPLETE');rows.push(...page.rows);
 }
 requireFormat(rows.length===m.row_count,'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
 const completed=await transport.request(`${prefix}/inventory-receipts/${m.receipt_id}/complete`,{schema_version:2,pages:m.pages.map(({index,checksum}:any)=>({index,checksum}))});
 requireFormat(same({...completed,complete:false},m)&&completed.complete===true,'POS_FORMAT_INVENTORY_ACK_INVALID');const downloaded={manifest:completed,rows};downloadSeals.set(downloaded,canonicalContent(downloaded));return downloaded;
}
export async function installInventoryV2(sql:FormatSQL,capture:Capture,download:Awaited<ReturnType<typeof downloadInventoryV2>>,validateAuthority:(tx:FormatSQL,c:NetworkContextV2)=>Promise<void>){
 requireFormat(sql.runFinancial,'POS_FORMAT_ATOMIC_STORAGE_REQUIRED');
 capture=sealed(capture,captureSeals);download=sealed(download,downloadSeals);
 return sql.runFinancial!(async tx=>{
  const c=capture.context;await validateAuthority(tx,c);const authority=await readNativeFormatAuthority(tx,c);await assertLocalCommitments(tx,c);
  requireFormat(authority.baseline===capture.nativeBaseline&&await generation(tx)===capture.generation&&await hashText(canonicalContent(await localLedger(tx,c)))===capture.ledgerHash,'POS_FORMAT_INVENTORY_GENERATION_CHANGED');
  const m=download.manifest,balances=download.rows.filter(r=>r.kind==='BALANCE'),events=download.rows.filter(r=>r.kind==='EVENT');
  requireFormat(balances.length===m.balance_count&&events.length===capture.originals.length&&new Set(balances.map(b=>b.item_id)).size===balances.length&&new Set(events.map(e=>e.event_id)).size===events.length,'POS_FORMAT_INVENTORY_RECEIPT_INVALID');
  balances.forEach(b=>validCell(b,c));
  const old=await tx.query<{manifest:string}>('SELECT manifest FROM article_format_inventory_v2_authority WHERE singleton=1',[]);
  if(old.length)requireFormat(BigInt(JSON.parse(old[0].manifest).ordinal)<BigInt(m.ordinal),'POS_FORMAT_INVENTORY_ORDINAL_STALE');
  const statements:FormatStatement[]=[{statement:'DELETE FROM article_format_inventory_v2_cells'}];
  for(const b of balances)statements.push({statement:'INSERT INTO article_format_inventory_v2_cells VALUES(?,?)',values:[b.item_id,canonicalContent(b)]});
  for(const event of events){const source=capture.originals.find(o=>o.event_id===event.event_id);requireFormat(source&&source.source_kind===event.source_kind&&same(JSON.parse(event.canonical_original),source.original)&&await hashText(event.canonical_original)===event.content_hash&&['INCLUDED','NO_PHYSICAL_EFFECT','NOT_INCLUDED','UNKNOWN'].includes(event.status),'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');
   if(event.status==='UNKNOWN'||event.status==='NOT_INCLUDED'){requireFormat(event.effects.length===0,'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');continue;}
   const ledger=capture.ledger.filter(l=>l.articleFormatEventId?l.articleFormatEventId===source.event_id:source.original.transaction?.id===l.documentRef);
   const effects=event.effects;requireFormat(Array.isArray(effects)&&new Set(effects.map((e:any)=>e.line_id)).size===effects.length,'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');
   const ids=new Set<string>();for(const effect of effects){requireFormat(effect.event_id===source.event_id&&effect.warehouse_id===c.scope.warehouseId&&effect.local_id===c.scope.localId&&balances.some(b=>b.item_id===effect.item_id),'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');
    const delta=signedBase4(effect.delta_base);if(event.status==='NO_PHYSICAL_EFFECT')requireFormat(delta.eq(0)&&effect.movement_id===null&&effect.movement_key===null,'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');else{uuid(effect.movement_id);requireFormat(!ids.has(effect.movement_id),'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');ids.add(effect.movement_id);}
    if(source.source_kind!=='ORDINARY_V3'){const line=source.original.lines.find((l:any)=>l.line_id===effect.line_id),sale=source.original.event_type==='ARTICLE_FORMAT_SALE_V1'||source.original.event_type==='ARTICLE_FORMAT_SALE_V2',policy=sale?null:source.original.return_context?.return_policy;requireFormat(line&&effect.item_id===line.item_id&&effect.variant_id===line.variant_id&&effect.return_policy===policy,'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');const expected=sale?new Money(line.base_quantity).negated():policy==='RESTOCK'?new Money(line.base_quantity):new Money(0);requireFormat(delta.eq(expected)&&(event.status==='NO_PHYSICAL_EFFECT'||effect.movement_key===`${source.event_id}:${line.line_id}`),'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');}
   }
   if(source.source_kind!=='ORDINARY_V3')requireFormat(effects.length===source.original.lines.length,'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');
   for(const l of ledger){const effects=event.effects.filter((e:any)=>e.item_id===l.productId&&(source.source_kind==='ORDINARY_V3'||e.line_id===l.articleFormatLineId));const sum=effects.reduce((n:InstanceType<typeof Money>,e:any)=>{requireFormat(e.warehouse_id===c.scope.warehouseId&&e.local_id===c.scope.localId,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');return n.plus(signedBase4(e.delta_base));},new Money(0));const expected=source.source_kind==='ORDINARY_V3'?ledger.filter(x=>x.productId===l.productId).reduce((n,x)=>n.plus(x.qtyIn).minus(x.qtyOut),new Money(0)):new Money(l.qtyIn).minus(l.qtyOut);requireFormat(sum.eq(expected),'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');}
   for(const l of ledger)statements.push({statement:'INSERT OR IGNORE INTO article_format_inventory_v2_absorbed VALUES(?,?,?)',values:[l.id,await hashText(canonicalContent(l)),m.receipt_id]});
  }
  statements.push({statement:'INSERT INTO article_format_inventory_v2_history VALUES(?,?)',values:[m.receipt_id,canonicalContent(m)]},{statement:'INSERT INTO article_format_inventory_v2_authority VALUES(1,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET authority_hash=excluded.authority_hash,scope=excluded.scope,expires_at=excluded.expires_at,native_baseline=excluded.native_baseline,manifest=excluded.manifest',values:[c.authority_hash,canonicalContent(c.scope),c.session_expires_at,capture.nativeBaseline,canonicalContent(m)]});
  await tx.executeAtomic(statements);
 });
}
export async function readInventoryV2(query:FormatSQL['query'],baseline:string,itemIds:string[],warehouseId:string){
 let selected:{scope:string;authority_hash:string;native_baseline:string;expires_at:string}[];
 try{selected=await query('SELECT scope,authority_hash,native_baseline,expires_at FROM article_format_inventory_v2_authority WHERE singleton=1',[]);}catch(e){if(e instanceof Error&&/no such table/.test(e.message))return undefined;throw e;}
 if(!selected.length)return undefined;requireFormat(selected.length===1&&selected[0].native_baseline===baseline&&Date.parse(selected[0].expires_at)>Date.now(),'POS_FORMAT_INVENTORY_AUTHORITY_CHANGED');
 const scope=JSON.parse(selected[0].scope);requireFormat(scope.warehouseId===warehouseId&&itemIds.length<=100,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');
 const out:Record<string,{physical:InstanceType<typeof Money>;committed:InstanceType<typeof Money>;reserved:InstanceType<typeof Money>;available:InstanceType<typeof Money>}>={};
 for(const itemId of new Set(itemIds)){
  const cells=await query<{content:string}>('SELECT content FROM article_format_inventory_v2_cells WHERE item_id=?',[itemId]);requireFormat(cells.length===1,'POS_FORMAT_STOCK_BASELINE_MISSING');const cell=JSON.parse(cells[0].content),stock=validCell(cell,{scope} as NetworkContextV2);
  const ledgers=await query<{doc_id:string;data:string;content_hash:string|null}>(`SELECT d.doc_id,d.data,a.content_hash FROM documents d LEFT JOIN article_format_inventory_v2_absorbed a ON a.ledger_id=d.doc_id WHERE d.collection_name='inventoryLedger' AND json_extract(d.data,'$.productId')=? AND json_extract(d.data,'$.warehouseId')=?`,[itemId,warehouseId]);
  for(const row of ledgers){const l=JSON.parse(row.data),binding=JSON.parse(l.v3Binding||'null');requireFormat(binding?.[0]===scope.tenantId&&binding?.[1]===scope.terminalId&&binding?.[2]===scope.deviceId,'POS_FORMAT_INVENTORY_UNREPRESENTED_EFFECT');if(row.content_hash){requireFormat(await hashText(canonicalContent(l))===row.content_hash,'POS_FORMAT_INVENTORY_EFFECT_CONFLICT');continue;}for(const k of ['qtyIn','qtyOut'])requireFormat(typeof l[k]==='number'&&Number.isFinite(l[k])&&l[k]>=0&&new Money(l[k]).dp()<=4,'POS_FORMAT_PRECISION_INVALID');stock.physical=stock.physical.plus(l.qtyIn).minus(l.qtyOut);}
  const commitments=await query<{data:string}>(`SELECT data FROM documents WHERE collection_name='inventoryCommitments' AND json_extract(data,'$.productId')=? AND json_extract(data,'$.warehouseId')=?`,[itemId,warehouseId]);for(const r of commitments)requireFormat(JSON.parse(r.data).qtyCommitted===0,'POS_FORMAT_INVENTORY_LOCAL_COMMITMENT_PROVENANCE_REQUIRED');
  out[itemId]={...stock,available:stock.physical.minus(stock.committed).minus(stock.reserved)};
 }return out;
}
