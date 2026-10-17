import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {CapacitorSQLiteAdapter} from '../../services/db/adapters/CapacitorSQLiteAdapter';
import {captureFiscalBoundContext} from '../../services/fiscal/FiscalBoundContext';
import {createAppliedReceiptReadiness,type FiscalOutboxAnchor} from '../../services/fiscal/FiscalAppliedReceiptV2';
export const wireFixture=(name='E32-none')=>JSON.parse(readFileSync(new URL('../fixtures/fiscal-applied-receipt-v2/'+name+'.json',import.meta.url),'utf8'));
export async function appliedFixture(name='E32-none',derive?:(wire:any)=>Promise<void>){
 const wire=wireFixture(name);if(derive)await derive(wire);const original=wire.originalSource.transaction,id=original.id,scope=wire.expectedResponse.scope,binding=JSON.parse(original.v3Binding),stamp=original.items[0].v3SaleAuthority;
 const directory=mkdtempSync(join(tmpdir(),'pos-applied-receipt-')),file=join(directory,'fixture.sqlite');let sql=new DatabaseSync(file),writes=0,failWrite=0,loseCommit=false;
 const adapter=new CapacitorSQLiteAdapter();
 const bridge={beginTransaction:async()=>sql.exec('BEGIN IMMEDIATE'),commitTransaction:async()=>sql.exec('COMMIT'),rollbackTransaction:async()=>sql.exec('ROLLBACK'),isTransactionActive:async()=>({result:sql.isTransaction}),
 query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v).map(row=>({...row}))}),run:async(q:string,v:any[]=[])=>{if(failWrite&&++writes===failWrite)throw Error('injected write');return sql.prepare(q).run(...v);},execute:async(q:string)=>{sql.exec(q);if(loseCommit&&q==='COMMIT;'){loseCommit=false;throw Error('lost commit ACK');}}};
 Object.assign(adapter,{db:bridge,isReady:true});await (adapter as any).initSchema();
 sql.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run(stamp.syncId,stamp.syncVersion,original.v3Binding);
 sql.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=?').run(stamp.syncId,stamp.syncVersion);
 sql.prepare("INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,'now')").run(stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor);
 sql.prepare('INSERT INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)').run(stamp.syncId,stamp.syncVersion,original.v3Binding,stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor);
 const config:any={id:'current',companyInfo:{rnc:wire.expectedResponse.issuer.rnc},terminals:[{id:scope.terminalId,config:{currentDeviceId:scope.deviceId,erpBinding:{tenantId:scope.tenantId,companyId:scope.companyId,storeId:scope.storeId}}}]};
 for(const [collection,doc] of [['transactions',original],['transactionHistory',original],['config',config]])sql.prepare('INSERT INTO documents(collection_name,doc_id,data,updatedAt) VALUES(?,?,?,?)').run(collection,(doc as any).id,JSON.stringify(doc),'now');
 const anchor=(row:any):FiscalOutboxAnchor=>({event_id:row.event_id,event_type:row.event_type,aggregate_type:'TRANSACTION',aggregate_id:id,schema_version:1,
  payload_json:JSON.stringify(row.payload.erp_fiscal_v3_application_plan_v1?.originalPayload||row.payload)});
 const anchors={sale:anchor(wire.materializedSnapshot.sources[0]),payment:wire.materializedSnapshot.sources[1]?anchor(wire.materializedSnapshot.sources[1]):null};
 for(const a of [anchors.sale,anchors.payment].filter(Boolean) as FiscalOutboxAnchor[])sql.prepare('INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,\'PENDING\',\'now\',\'now\')').run(a.event_id,a.event_type,a.aggregate_type,a.aggregate_id,a.schema_version,a.payload_json);
 const identity={erpSyncBaseUrl:binding[3],tenantId:scope.tenantId,terminalId:scope.terminalId,deviceId:scope.deviceId,syncToken:'synthetic-sync-token'};
 const credentials:any={...identity,companyId:scope.companyId,storeId:scope.storeId,deviceToken:'synthetic-device-token',deviceTokenSource:'ERP_REGISTER',authStatus:'ERP_ACTIVE'};
 const get=async(name:string,key:string)=>{const row=sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(name,key);return row?JSON.parse(String(row.data)):null;};
 const context=()=>captureFiscalBoundContext(()=>identity,()=>credentials);
 let handler:(req:any,res:any,body:string)=>any=(_req,res)=>res.end('{}');
 const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{Promise.resolve(handler(req,res,body)).catch(error=>{res.statusCode=500;res.end(String(error));});});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;
 // Explicit test forwarding only: record/assert fixed ERP URL, then use the local HTTP socket. Never edit original binding.
 const requests:Array<{url:string;init?:RequestInit}>=[];
 const fetchImpl:typeof fetch=async(input,init)=>{const url=new URL(String(input));if(url.origin!=='https://erp.fixture.invalid')throw Error('fixture origin changed');requests.push({url:String(input),init});return fetch('http://127.0.0.1:'+port+url.pathname+url.search,init);};
 const pair=async()=>({transaction:await get('transactions',id),history:await get('transactionHistory',id)});
 const catalog=async()=>({syncId:stamp.syncId,syncVersion:stamp.syncVersion,binding:original.v3Binding});
 const readiness=createAppliedReceiptReadiness({pair,catalog:()=>deps.catalog(),rows:key=>adapter.getFiscalAppliedSourceRows(key),context,fetchImpl,timeoutMs:1000});
 const deps:any={outboxRows:(key:string)=>adapter.getFiscalAppliedSourceRows(key),assertReady:readiness,context,get,commit:(rows:any[])=>adapter.saveDocumentsAtomically(rows),fetchImpl,catalog,timeoutMs:1000};
 const input:any={providerId:'MSELLER',environment:wire.expectedResponse.historicalEnvironment,transaction:structuredClone(original),credentialKey:wire.expectedResponse.issuer.rnc,sequenceExpiryDate:original.fiscalIssuance.expiryDate??undefined,companyInfo:{name:'Synthetic',rnc:wire.expectedResponse.issuer.rnc}};
 const standard=(req:any,res:any)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='GET'?wire.expectedResponse:{success:true,providerId:'MSELLER',environment:input.environment,documentCode:input.transaction.ncfType,pending:false,status:'ACCEPTED',eNCF:'FOREIGN',message:'secret-token-echo'}));};handler=standard;
 return{wire,original,id,scope,binding,stamp,anchors,input,deps,adapter,identity,credentials,requests,get,pair,readiness,context,sql:()=>sql,
 handle:(h:typeof handler)=>{handler=h;},standard,fail:(n:number)=>{writes=0;failWrite=n;},loseCommit:()=>{loseCommit=true;},restart:()=>{sql.close();sql=new DatabaseSync(file);},
 close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));sql.close();rmSync(directory,{recursive:true,force:true});}};
}
