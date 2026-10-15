/** Host SQLite/native bridge + HTTP mock fixtures. Never a device or ERP integration assertion. */
import {ArticleFormatInventoryJournal,installInventoryFixtureBinding} from '../services/articleFormats/inventoryJournal';
import {downloadInventoryReceipt,type InventoryScope,type InventoryPage,type InventoryManifest,type InventoryEventResult,type InventoryBalance,type JournalOriginal} from '../services/articleFormats/inventoryContract';
import {hashText,postgresJSON,type FormatTransport} from '../services/articleFormats/wire';
import {nativeFixture,id} from './articleFormatsNativeFixture';
export const scope:InventoryScope={tenant_id:id(1),company_id:id(2),store_id:id(3),terminal_id:id(4),device_id:id(50),warehouse_id:id(5),local_id:id(70)};
export async function inventoryFixture(...args:Parameters<typeof nativeFixture>){
 const f=await nativeFixture(...args);const journal=new ArticleFormatInventoryJournal(f.sql);await journal.migrate();
 await installInventoryFixtureBinding(f.sql,{scope,authorization:'synthetic-fixture-auth-v1'});
 const baseline=()=>{const r=f.db.prepare('SELECT * FROM master_v3_inventory_state').get() as any;
  const owner=f.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any;
  return JSON.stringify([owner.binding,r.sync_id,r.sync_version,r.inventory_version,r.cursor]);};
 const reservations=async(baseline_id:string,quantities:Record<string,string>={[id(7)]:'0.0000'})=>installInventoryFixtureBinding(f.sql,{scope,authorization:'synthetic-fixture-auth-v1',reservationAuthority:{baseline_id,quantities}});
 return {...f,journal,baseline,reservations};
}
export type InventoryCapture=Awaited<ReturnType<ArticleFormatInventoryJournal['captureFixture']>>;
export async function receiptTransport(capture:InventoryCapture,opts:{baselineId?:string;receiptId?:string;ordinal?:string;physical?:string;statuses?:Record<string,InventoryEventResult['status']>;extraBalances?:InventoryBalance[];mutate?:(path:string,result:any)=>any}={}){
 const baselineId=opts.baselineId || id(1000),receiptId=opts.receiptId || id(2000);
 const balances:InventoryBalance[]=[{kind:'BALANCE',item_id:id(7),warehouse_id:scope.warehouse_id,local_id:scope.local_id,qty_physical:opts.physical || '89.0000',qty_committed:'0.0000'},...(opts.extraBalances || [])];
 const results:InventoryEventResult[]=await Promise.all(capture.originals.map(async(o:JournalOriginal)=>{
  const status=opts.statuses?.[o.event.event_id] || 'INCLUDED',canonical_original=postgresJSON(o.event);
  return {kind:'EVENT',event_id:o.event.event_id,canonical_original,content_hash:await hashText(canonical_original),status,
   effects:['UNKNOWN','NOT_INCLUDED'].includes(status)?[]:o.effects.map((e,index)=>({...e,movement_id:status==='NO_PHYSICAL_EFFECT'?null:id(3000+capture.originals.indexOf(o)*200+index),movement_key:status==='NO_PHYSICAL_EFFECT'?null:`${e.event_id}:${e.line_id}`}))};
 }));
 const rows=[...balances,...results],pages:InventoryPage[]=[];
 for(let i=0;i<Math.max(1,Math.ceil(rows.length/100));i++){
  const chunk=rows.slice(i*100,(i+1)*100),canonical_payload_text=JSON.stringify(chunk);
  pages.push({schema_version:1,receipt_id:receiptId,baseline_id:baselineId,index:i,next_index:(i+1)*100<rows.length?i+1:null,
   row_count:chunk.length,checksum:await hashText(canonical_payload_text),canonical_payload_text,rows:chunk});
 }
 const manifest:InventoryManifest={schema_version:1,receipt_id:receiptId,baseline_id:baselineId,ordinal:opts.ordinal || '9007199254740993',scope:capture.scope,
  journal_generation:capture.state.generation,requested_event_ids:capture.originals.map(o=>o.event.event_id),balance_grain:'ITEM_LOCAL_AGGREGATE',quantity_scale:4,
  balance_count:balances.length,event_count:results.length,row_count:rows.length,page_size:100,page_count:pages.length,
  pages:pages.map(({index,checksum,row_count})=>({index,checksum,row_count})),checksum:await hashText(pages.map(p=>p.checksum).join('')),complete:false};
 const requests:{path:string;body:any}[]=[];
 const transport:FormatTransport={request:async(path,body)=>{
  requests.push({path,body:structuredClone(body)});let result:any;
  if(path.endsWith('/negotiate'))result={inventory_reconciliation:{schema_version:1,supported:true,capability:'article_formats_inventory_reconciliation',readiness_required:true,balance_grain:'ITEM_LOCAL_AGGREGATE',quantity_scale:4,baselines_url:'/api/sync/article-formats/v1/inventory-baselines'}};
  else if(path.endsWith('/inventory-baselines'))result={...manifest,cut_kind:'MATERIALIZED_MVCC',snapshot_descriptor:'mock-mvcc-cut'};
  else if(path.endsWith('/receipts'))result=manifest;
  else if(path.endsWith('/complete'))result={...manifest,complete:true};
  else if(/\/pages\/\d+$/.test(path))result=pages[Number(path.split('/').at(-1))];
  else throw Error(`unexpected mock path ${path}`);
  result=structuredClone(result);return opts.mutate?opts.mutate(path,result):result;
 }};
 const download=()=>downloadInventoryReceipt(transport,capture.scope,capture.state.generation,capture.originals,async()=>{});
 return {transport,manifest,pages,requests,download};
}
