import SQLite from 'better-sqlite3';
import type { FormatSQL } from '../services/articleFormats/store';
import { ARTICLE_FORMATS_SCHEMA } from '../services/articleFormats/schema';
import { ARTICLE_FORMAT_WIRE_SCHEMA } from '../services/articleFormats/posting';
import type { NetworkContext } from '../services/articleFormats/wire';
export const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const context:NetworkContext={contract:'ARTICLE_FORMATS',schema_version:1,ingress_version:1,master_contract_version:3,profile:'DOP_SETTLED_REALTIME_V1',variant_identity:'ERP_ID',grant_revision:1,
 scope:{tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),warehouseId:id(5)},tariff_ids:[id(6)],return_policy:'RESTOCK',
 return_context_contract_version:1,return_context_required:true,return_context_supported:true,return_context:{schema_version:1,id:id(200),grant_revision:1,fingerprint:'a'.repeat(64),return_policy:'RESTOCK'},
 event_types:['ARTICLE_FORMAT_SALE_V1','ARTICLE_FORMAT_RETURN_V1','ARTICLE_FORMAT_VOID_V1'],events_url:'/api/sync/article-formats/v1/events',master_sessions_url:'/api/sync/v3/master-syncs'};
export function contextForPolicy(return_policy: 'RESTOCK'|'DAMAGED'|'NO_RETURN'):NetworkContext {
 return {...structuredClone(context),return_policy,return_context:{...context.return_context!,return_policy}};
}
export function sqlitePort(db:SQLite.Database,fault?:{before?:number;afterCommit?:boolean}):FormatSQL {
 let queue=Promise.resolve();
 const direct:FormatSQL={executeSchema:async sql=>{db.pragma('foreign_keys=ON');db.exec(sql);},query:async<T>(sql:string,values:(string|number|null)[])=>db.prepare(sql).all(...values) as T[],
 executeAtomic:async statements=>{
  db.transaction(()=>{for(let i=0;i<statements.length;i++){if(fault?.before===i)throw Error(`injected:${i}`);const s=statements[i];db.prepare(s.statement).run(...(s.values||[]));}
   if(fault?.before===statements.length)throw Error('injected:beforeCommit');})();
  if(fault?.afterCommit)throw Error('injected:afterCommit');
 }};
 const exclusive=<T>(work:(sql:FormatSQL)=>Promise<T>):Promise<T>=>{const result=queue.then(()=>work(direct));queue=result.then(()=>undefined,()=>undefined);return result;};
 return {...direct,executeAtomic:s=>exclusive(sql=>sql.executeAtomic(s)),runExclusive:exclusive};
}
export function seedCollections(db:SQLite.Database,ctx=context,itemId=id(7),quantity=137){
 db.exec('CREATE TABLE IF NOT EXISTS collections(key TEXT PRIMARY KEY,value TEXT NOT NULL,updatedAt TEXT NOT NULL);'+ARTICLE_FORMATS_SCHEMA+ARTICLE_FORMAT_WIRE_SCHEMA);
 const product={id:itemId,name:'Synthetic',type:'PRODUCT',isInventoriable:true,variants:[],stock:quantity,stockBalances:{[ctx.scope.warehouseId]:quantity},cost:35,operationalFlags:{trackInventory:true,allowNegativeStock:false}};
 const collections={products:[product],productStocks:[{id:`${itemId}_${ctx.scope.warehouseId}`,productId:itemId,warehouseId:ctx.scope.warehouseId,quantity,qtyPhysical:quantity,qtyCommitted:0,qtyAvailable:quantity}],
 inventoryLedger:[{id:id(8),productId:itemId,warehouseId:ctx.scope.warehouseId,qtyIn:quantity,qtyOut:0,unitCost:35,createdAt:'2026-10-01T00:00:00Z'}],
 internalSequences:[{id:id(9),documentType:'TICKET',prefix:'TCK-',nextNumber:1,padding:6},{id:id(10),documentType:'REFUND',prefix:'REF-',nextNumber:1,padding:6}],globalSequenceCounter:[{id:'value',count:0}],transactions:[],transactionHistory:[],payments:[]};
 for(const [key,value] of Object.entries(collections))db.prepare('INSERT OR REPLACE INTO collections VALUES(?,?,?)').run(key,JSON.stringify(value),'fixture');
 return product;
}
