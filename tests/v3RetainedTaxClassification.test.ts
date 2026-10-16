import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

for(const intent of ['SALE','REFUND']) for(const changed of [true,false]) test(`actual retained ${intent} affected=${changed} blocks before financial consumers`,async()=>{
 const stamp={binding:'B',warehouseId:'W',tariffId:'T',syncId:'old',syncVersion:1,inventoryVersion:1,inventoryCursor:'C',taxIncluded:false};
 const line={id:'P',cartId:'P',quantity:1,price:85,appliedTaxIds:['TIP'],v3SaleAuthority:stamp};
 const source={product:{...line,type:'SERVICE',activeInWarehouses:['W']},authority:stamp};
 const old=[{id:'TIP',type:'VAT',rate:.1,active:true}],current=[{...old[0],type:changed?'SERVICE_CHARGE':'VAT'}];
 let taxReads=0,validated=0;
 Object.assign(globalThis,{__retainedTaxFixture:{source,context:{items:[line]},old}});
 const mocks:Record<string,string>={
  './LargeMasterSyncV3RetainedCheckout':`export const readV3RetainedCheckout=async()=>globalThis.__retainedTaxFixture.context;export const assertV3RetainedLine=()=>{};`,
  './LargeMasterSyncV3OperationalCatalog':`export class LargeMasterSyncV3OperationalCatalog{static async open(){return{get:async()=>globalThis.__retainedTaxFixture.source}}}`,
  './LargeMasterSyncV3Runtime':`export class LargeMasterSyncV3Runtime{static retained(){return {}}}`,
  './LargeMasterSyncV3CheckoutAuthority':'export const buildLargeMasterSyncV3CheckoutFiscalInput=()=>{};',
  './LargeMasterSyncV3LineSource':'export const validateV3PinnedLineSource=()=>{};export const validateV3FrozenLineFiscalAmounts=()=>{throw new Error("Unexpected reservation fiscal validation in retained-tax fixture")};',
  '../../utils/db':'export const db={};','../db':'export const dbAdapter={};',
  './LargeMasterSyncV3Authority':'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;export const assertLegacyMasterPullAllowed=()=>{};export const usesLargeMasterSyncV3Authority=()=>true;',
  './LargeMasterSyncV3Canary':'export const LARGE_MASTER_SYNC_V3_CANARY=false;export const validateLargeMasterSyncV3CanaryUrl=x=>x;',
 };
 const bundle=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const {LargeMasterSyncV3OperationalSession}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n//${intent}${changed}`).toString('base64'));
 const session=new LargeMasterSyncV3OperationalSession({runtime:{version:{syncId:'new',syncVersion:2},getOperationalTaxes:async()=>current},inventoryVersion:1,inventoryCursor:'C'},'B',{
  getInventoryAuthority:async()=>({syncId:'old',syncVersion:1,version:1,cursor:'C'}),getOperationalTaxes:async()=>{taxReads++;return old;},
  getCatalogReceipt:async()=>({syncId:'old',syncVersion:1,version:1,cursor:'C'})},'origin',{deviceId:'device'});
 session.assertCurrent=async()=>{};session.catalog=async()=>({get:async()=>source});session.withStock=async(product:any)=>product;
 const validate=()=>session.validate({terminals:[],taxes:current},[line], 'T','W',intent,()=>{validated++;},{ticketId:'parked',originalTransactionId:'original'});
 if(changed){await assert.rejects(validate,/RETAINED_TAX_CLASSIFICATION_CHANGED/);assert.equal(validated,0);}
 else{await validate();assert.equal(validated,1);}
 assert.equal(taxReads,1);
 if(changed){await session.validate({terminals:[],taxes:current},[line],'T','W',intent,undefined,{originalTransactionId:'original'},true);assert.equal(taxReads,1);}
});
