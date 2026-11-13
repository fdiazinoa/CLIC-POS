import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transaction } from '../types';
import { db } from '../utils/db';
import { readRefundOriginal } from '../services/localRefundPersistence';
import { assertRefundFinancialSource, refundFinancialSourceIdentity } from '../services/sync/LargeMasterSyncV3RefundAuthority';
import { nativeFixture, seedNativeFiscal } from './articleFormatsNativeFixture';

async function fixture(run: (f: Awaited<ReturnType<typeof nativeFixture>>, source: Transaction, put: (collection: string, row: any) => void) => Promise<void>) {
 const f=await nativeFixture(),get=db.getDocument;
 try {
  seedNativeFiscal(f);
  const binding=(f.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any).binding;
  const source={id:'original',displayId:'TCK-SYNTHETIC',status:'COMPLETED',documentType:'TICKET',date:'2026-11-12T12:00:00Z',
   items:[{id:'item',cartId:'line',price:150,quantity:1,taxAmount:27,netAmount:150,totalAmount:177,appliedTaxIds:['vat'],v3SaleAuthority:{binding}}],
   payments:[{id:'payment',method:'CASH',amount:177}],customerSnapshot:{id:'customer'},relatedTransactions:[],
   total:177,netAmount:150,taxAmount:27,v3Binding:binding,v3InventoryBaseline:'baseline'} as unknown as Transaction;
  const put=(collection:string,row:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(collection,row.id,JSON.stringify(row),0,'fixture');
  db.getDocument=((name:string,id:string)=>f.adapter.getDocument(name,id)) as any;
  await run(f,source,put);
 } finally {db.getDocument=get;f.db.close();}
}

test('real readRefundOriginal accepts only root UI archive marker with active and Z-history copies',async()=>fixture(async(f,source,put)=>{
 put('transactions',source);put('transactionHistory',{...source,zReportId:'closed-Z'});
 const before=f.state(),identity=refundFinancialSourceIdentity(source);
 for(const flag of [true,false,undefined]){
  const captured={...source,zReportId:'closed-Z',...(flag===undefined?{}:{_isArchived:flag})} as unknown as Transaction;
  const capturedBefore=JSON.stringify(captured);
  assert.equal(refundFinancialSourceIdentity(captured),identity);
  assert.deepEqual(await readRefundOriginal(captured),source);
  assert.equal(JSON.stringify(captured),capturedBefore);
 }
 assert.deepEqual(f.state(),before,'authorization must not reserve numbers or write stock/payments/NC');
}));

test('real readRefundOriginal authorizes archive-only source only with stored Z membership',async()=>fixture(async(f,source,put)=>{
 put('transactionHistory',{...source,zReportId:'closed-Z'});const before=f.state();
 assert.deepEqual(await readRefundOriginal({...source,_isArchived:true} as unknown as Transaction),{...source,zReportId:'closed-Z'});
 assert.deepEqual(f.state(),before);
 put('transactionHistory',source);const noMembership=f.state();
 await assert.rejects(()=>readRefundOriginal({...source,_isArchived:true} as unknown as Transaction),/ORIGINAL_CHANGED/);
 assert.deepEqual(f.state(),noMembership);
}));

test('presentation exception never hides nested markers or true financial changes',async()=>fixture(async(f,source,put)=>{
 put('transactions',source);put('transactionHistory',{...source,zReportId:'closed-Z'});const before=f.state();
 const variants=[
  {...source,items:[{...source.items[0],_isArchived:true}]},
  {...source,payments:[{...source.payments[0],_isArchived:true}]},
  {...source,customerSnapshot:{...source.customerSnapshot,_isArchived:true}},
  {...source,items:[{...source.items[0],price:149}]},
  {...source,taxAmount:26}, {...source,total:176},
  {...source,items:[{...source.items[0],appliedTaxIds:['different-tax']}]},
  {...source,items:[{...source.items[0],quantity:2}]},
  {...source,payments:[{...source.payments[0],amount:176}]},
  {...source,v3Binding:'different'}, {...source,v3InventoryBaseline:'different'},
  {...source,id:'different'}, {...source,unknownRootFlag:true}, {...source,_isArchivedExtra:true},
 ];
 for(const variant of variants){
  assert.throws(()=>assertRefundFinancialSource(source,variant as Transaction),/ORIGINAL_CHANGED/);
  await assert.rejects(()=>readRefundOriginal({...variant,_isArchived:true} as unknown as Transaction),/ORIGINAL_CHANGED/);
 }
 assert.deepEqual(f.state(),before);
}));

test('root UI marker does not weaken stale commercial version or active/history conflict checks',async()=>fixture(async(f,source,put)=>{
 for(const fresh of [{...source,status:'PARTIAL_REFUND',relatedTransactions:['existing-refund']},{...source,relatedTransactions:['existing-refund']}]){
  put('transactions',fresh);put('transactionHistory',fresh);const before=f.state();
  await assert.rejects(()=>readRefundOriginal({...source,_isArchived:true} as unknown as Transaction),/ORIGINAL_CHANGED/);assert.deepEqual(f.state(),before);
 }
 put('transactions',source);put('transactionHistory',{...source,total:178,zReportId:'closed-Z'});const conflict=f.state();
 await assert.rejects(()=>readRefundOriginal({...source,_isArchived:true} as unknown as Transaction),/ORIGINAL_CHANGED/);assert.deepEqual(f.state(),conflict);
}));

test('archive UI marker cannot authorize missing, refunded or refund-document originals',async()=>fixture(async(f,source,put)=>{
 await assert.rejects(()=>readRefundOriginal({...source,_isArchived:true} as unknown as Transaction),/ORIGINAL_CHANGED/);
 for(const fresh of [{...source,status:'REFUNDED'},{...source,documentType:'REFUND'}]){
  put('transactions',fresh);const before=f.state();
  await assert.rejects(()=>readRefundOriginal({...fresh,_isArchived:true} as unknown as Transaction),/ORIGINAL_(?:CHANGED|NOT_REFUNDABLE)/);assert.deepEqual(f.state(),before);
 }
}));
