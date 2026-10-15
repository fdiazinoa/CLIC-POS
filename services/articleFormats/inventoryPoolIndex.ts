import type {FormatSQL,FormatStatement} from './store';

export const INVENTORY_POOL_INDEX_SQL="CREATE INDEX IF NOT EXISTS article_format_inventory_document_pool ON documents(json_extract(data,'$.warehouseId'),json_extract(data,'$.productId')) WHERE collection_name='inventoryLedger';";
export const INVENTORY_POOL_INDEX_DROP='DROP INDEX article_format_inventory_document_pool;';
export const INVENTORY_POOL_USE_TABLES=[...['binding','state','originals','effects','links','balances','absorptions','authorities','history','staging'].map(n=>`article_format_inventory_${n}`),'article_format_outbox','article_format_base_movements'];
const index='article_format_inventory_document_pool',wire='article_format_wire_events';
const identity=(sql:string)=>{
 const tokens=sql.trim().replace(/;$/,'').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[^\s]/g) || [];
 if(tokens[0]==='CREATE'&&tokens[1]==='INDEX'&&tokens.slice(2,5).join(' ')==='IF NOT EXISTS')tokens.splice(2,3);
 return JSON.stringify(tokens);
};
/** Exact fixed DDL only; native scoped transactions dispatch these through execute(false). */
export function isInventoryPoolDDL(entry:FormatStatement){return !entry.values?.length&&(entry.statement===INVENTORY_POOL_INDEX_SQL||entry.statement===INVENTORY_POOL_INDEX_DROP);}
async function validate(sql:FormatSQL){
 const schema=await sql.query<any>('SELECT type,tbl_name,sql FROM sqlite_master WHERE name=?',[index]);
 if(!schema.length)return false;
 const list=await sql.query<any>("PRAGMA index_list('documents')",[]),keys=await sql.query<any>("PRAGMA index_xinfo('article_format_inventory_document_pool')",[]),entry=list.filter(r=>r.name===index);
 if(schema.length!==1||schema[0].type!=='index'||schema[0].tbl_name!=='documents'||typeof schema[0].sql!=='string'||identity(schema[0].sql)!==identity(INVENTORY_POOL_INDEX_SQL)
  ||entry.length!==1||entry[0].unique!==0||entry[0].partial!==1||entry[0].origin!=='c'||keys.length!==3
  ||keys.some((r,i)=>r.seqno!==i||r.cid!==(i<2?-2:-1)||r.name!==null||r.desc!==0||r.coll!=='BINARY'||r.key!==(i<2?1:0)))throw Error('POS_FORMAT_INVENTORY_POOL_INDEX_INVALID');
 return true;
}
/** Caller owns one transaction and the shared native queue. Never grants physical authority. */
export async function ensureInventoryPoolIndex(sql:FormatSQL){
 if(sql.storageLayout!=='DOCUMENTS')return;
 await sql.executeAtomic([{statement:INVENTORY_POOL_INDEX_SQL}]);if(!await validate(sql))throw Error('POS_FORMAT_INVENTORY_POOL_INDEX_INVALID');
}
/** Before WIRE migration its table may be absent; all inventory/basic tables are mandatory. Caller owns the transaction. */
export async function reconcileInventoryPoolIndex(sql:FormatSQL,requireWire:boolean){
 if(sql.storageLayout!=='DOCUMENTS')return;
 const expected=['documents',...INVENTORY_POOL_USE_TABLES],names=[...expected,wire];
 const tables=await sql.query<{name:string}>(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${names.map(()=>'?').join(',')})`,names);
 const found=new Set(tables.map(r=>r.name));
 if(expected.some(n=>!found.has(n))||(requireWire&&!found.has(wire)))throw Error('POS_FORMAT_INVENTORY_POOL_SCHEMA_INCOMPLETE');
 const used=await sql.query<{used:number}>(`SELECT ${[...INVENTORY_POOL_USE_TABLES,...(found.has(wire)?[wire]:[])].map(n=>`EXISTS(SELECT 1 FROM ${n})`).join(' OR ')} AS used`,[]);
 if(used.length!==1||![0,1].includes(used[0].used))throw Error('POS_FORMAT_INVENTORY_POOL_USAGE_UNPROVEN');
 if(used[0].used){await ensureInventoryPoolIndex(sql);return;}
 if(await validate(sql))await sql.executeAtomic([{statement:INVENTORY_POOL_INDEX_DROP}]);
}
