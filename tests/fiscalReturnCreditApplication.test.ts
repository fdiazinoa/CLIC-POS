import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import {createFiscalCreditApplicationService} from '../services/fiscal/FiscalReturnCreditApplication';
import {RETURN_PROFILE,RETURN_CREDIT_PATH} from '../services/fiscal/FiscalReturnV1';
async function setup(){
 const f=await nativeFixture(),scope={tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50)},requests:string[]=[],receipts=new Map<string,any>();
 let enabled=true,loseResponse=false,failProjection=false,changedScope=false;
 const customer:any={id:id(200),source_customer_id:'POS-CUSTOMER',name:'Synthetic customer',currentDebt:100,wallet:{id:'ERP-wallet',customerId:id(200),balance:100,currency:'DOP',status:'ACTIVE'}};
 f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('customers',customer.id,JSON.stringify(customer),1,'fixture');
 const capability:any={schemaVersion:1,version:1,capability:'fiscalReturnV1',profile:RETURN_PROFILE,enabled:true,ready:true,operationKind:'RETURN',ncfType:'E34',birthSchemaVersion:3,eventSchemaVersion:1,scope,bindingAuthorityHash:'a'.repeat(64),authorizationId:id(900),authorityHash:'b'.repeat(64),environment:0,issuerRnc:'101010101',requiresOnlinePreparation:true,readiness:{admission:true,recovery:true,bank:true},transport:{requiresPreservedOuterContract:true,batch:{enabled:true,path:'/api/sync/inbox/batch'}},settlement:{schemaVersion:1,enabled:true,defaultDestination:'ORIGINAL_PAYMENT',destinations:['ORIGINAL_PAYMENT','CUSTOMER_CREDIT'],requiresEmptyPayments:true,creditApplicationPath:RETURN_CREDIT_PATH}};
 const tx:any={id:'immutable-sale',documentType:'TICKET',customerId:'POS-CUSTOMER',pendingBalance:100,payments:[{method:'CREDIT',amount:100}],total:100};
 const context:any=()=>({descriptor:scope,assertCurrent:()=>{if(changedScope)throw Error('FISCAL_RETURN_SCOPE_MISMATCH');}});
 const ports:any={store:()=>f.adapter.fiscalCreditApplicationStore,context,capability:async()=>({...capability,settlement:{...capability.settlement,enabled}}),
  consult:async()=>({transactionId:tx.id,scope,documentId:id(201)}),customers:async()=>{if(failProjection)throw Error('projection unavailable');return[structuredClone(customer)];},
  getCustomer:(id:string)=>f.adapter.getDocument('customers',id),getWallet:(id:string)=>f.adapter.getDocument('wallets',id),getWallets:()=>f.adapter.getCollection('wallets'),notify:()=>{},post:async(bytes:string)=>{
   requests.push(bytes);const c=JSON.parse(bytes);assert.deepEqual(Object.keys(c).sort(),['amount','customerId','invoiceId','operationId','schemaVersion']);
   const durable=f.db.prepare('SELECT data FROM pos_fiscal_credit_applications_v1 WHERE id=?').get(c.operationId) as any;assert.equal(JSON.parse(durable.data).commandBytes,bytes);
   let result=receipts.get(c.operationId);if(!result){customer.wallet.balance-=c.amount;customer.currentDebt-=c.amount;result={...c,currency:'DOP',destination:'INVOICE_DEBT',walletBalance:customer.wallet.balance,receiptEntryId:id(202),accountingEntryId:id(203)};receipts.set(c.operationId,result);}
   if(loseResponse){loseResponse=false;throw Error('lost response');}return result;
  }};
 const service=createFiscalCreditApplicationService(ports);
 return{...f,scope,requests,receipts,customer,tx,ports,service,target:await service.inspect(tx),disable:()=>enabled=false,lose:()=>loseResponse=true,projectionFailure:(v=true)=>failProjection=v,switchScope:()=>changedScope=true};
}
test('credit application is durable before POST and concurrent callers use one receipt without local debit/events',async t=>{
 const f=await setup();t.after(()=>f.db.close());const before=JSON.stringify(f.tx),[a,b]=await Promise.all([f.service.apply(f.target,30),f.service.apply(f.target,30)]);
 assert.equal(a.attempt.id,b.attempt.id);assert.equal(f.requests.length,1);assert.equal(f.receipts.size,1);assert.equal(a.projectionPending,false);
 assert.equal(f.documents('customers')[0].wallet.balance,70);assert.equal(f.documents('wallets')[0].balance,70);
 assert.equal(f.documents('wallet_transactions').length,0);assert.equal(f.documents('cashMovements').length,0);assert.equal(f.documents('inventoryLedger').length,0);assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,0);assert.equal(JSON.stringify(f.tx),before);
});
test('lost response reopens with exact command while capability is OFF and never repeats a server debit',async t=>{
 const f=await setup();t.after(()=>f.db.close());f.lose();await assert.rejects(()=>f.service.apply(f.target,30),/lost response/);f.disable();
 const reopened=createFiscalCreditApplicationService(f.ports),result=await reopened.apply(f.target,99);
 assert.equal(result.attempt.receipt?.amount,30);assert.equal(f.requests.length,2);assert.equal(f.requests[0],f.requests[1]);assert.equal(f.receipts.size,1);assert.equal(f.customer.wallet.balance,70);
 await reopened.apply(f.target,99);assert.equal(f.requests.length,2,'receipt recovery must not start another consumption');
});
test('projection failure leaves the receipt durable and retry refreshes without another POST; new consumption is explicit',async t=>{
 const f=await setup();t.after(()=>f.db.close());const post=f.ports.post;f.ports.post=async(bytes:string)=>{const r=await post(bytes);f.projectionFailure();return r;};
 const result=await f.service.apply(f.target,30);assert.equal(result.projectionPending,true);assert.ok(result.attempt.receipt);assert.equal(f.documents('customers')[0].wallet.balance,100);
 f.projectionFailure(false);const refreshed=await f.service.apply(f.target,90);assert.equal(refreshed.projectionPending,false);assert.equal(f.requests.length,1);
 f.ports.post=post;await f.service.apply(f.target,20,true);assert.equal(f.requests.length,2);assert.equal(f.receipts.size,2);assert.notEqual(JSON.parse(f.requests[0]).operationId,JSON.parse(f.requests[1]).operationId);
});
test('scope/disabled/new invalid operations never POST and pending local customer edits survive projection',async t=>{
 const f=await setup();t.after(()=>f.db.close());f.disable();await assert.rejects(()=>f.service.apply(f.target,10),/SETTLEMENT_DISABLED/);assert.equal(f.requests.length,0);
 const g=await setup();t.after(()=>g.db.close());g.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('customerMutations','pending',JSON.stringify({id:'pending',customerId:'POS-CUSTOMER',syncStatus:'PENDING'}),0,'fixture');
 const result=await g.service.apply(g.target,10);assert.equal(result.projectionPending,true);assert.equal(g.documents('customerMutations').length,1);assert.equal(g.documents('customers')[0].wallet.balance,100);
 g.switchScope();await assert.rejects(()=>g.service.apply(g.target,10),/SCOPE_MISMATCH/);assert.equal(g.requests.length,1);
});

test('known local wallet ID remains one coherent row with ERP alias; pending wallet movement blocks projection',async t=>{
 const f=await setup();t.after(()=>f.db.close());const local={...f.customer.wallet,id:'WLT-local',customerId:f.customer.id};
 f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('wallets',local.id,JSON.stringify(local),0,'fixture');const c={...f.customer,wallet:local};f.db.prepare("UPDATE documents SET data=? WHERE collection_name='customers' AND doc_id=?").run(JSON.stringify(c),c.id);
 const result=await f.service.apply(f.target,10);assert.equal(result.projectionPending,false);assert.equal(f.documents('wallets').length,1);assert.equal(f.documents('wallets')[0].id,'WLT-local');assert.equal(f.documents('wallets')[0].balance,90);assert.equal(f.documents('wallets')[0].erpWalletId,'ERP-wallet');
 const g=await setup();t.after(()=>g.db.close());g.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('wallet_transactions','pending-wallet',JSON.stringify({id:'pending-wallet',walletId:'ERP-wallet',syncStatus:'PENDING'}),0,'fixture');
 const held=await g.service.apply(g.target,10);assert.equal(held.projectionPending,true);assert.equal(g.documents('customers')[0].wallet.balance,100);assert.equal(g.documents('wallet_transactions').length,1);
});
test('concurrent local wallet write during ERP pull is retained instead of being overwritten',async t=>{
 const f=await setup();t.after(()=>f.db.close());const wallet={...f.customer.wallet};f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('wallets',wallet.id,JSON.stringify(wallet),0,'fixture');
 const pull=f.ports.customers;let calls=0;f.ports.customers=async()=>{const rows=await pull();if(++calls===2){const changed={...wallet,balance:123};f.db.prepare("UPDATE documents SET data=? WHERE collection_name='wallets' AND doc_id=?").run(JSON.stringify(changed),wallet.id);}return rows;};
 const result=await f.service.apply(f.target,10);assert.equal(result.projectionPending,true);assert.equal(f.documents('wallets')[0].balance,123);assert.equal(f.requests.length,1);
});
test('malformed receipt is held with the same operation, then recovered without a second server effect',async t=>{
 const f=await setup();t.after(()=>f.db.close());const post=f.ports.post;let corrupt=true;f.ports.post=async(bytes:string)=>{const r=await post(bytes);return corrupt?{...r,customerId:id(999)}:r;};
 await assert.rejects(()=>f.service.apply(f.target,10),/RECEIPT_INVALID/);assert.equal(f.documents('customers')[0].wallet.balance,100);corrupt=false;
 await f.service.apply(f.target,10);assert.equal(f.requests[0],f.requests[1]);assert.equal(f.receipts.size,1);
});
test('invalid target or non-cent amounts never persist or POST a new consumption',async t=>{
 const f=await setup();t.after(()=>f.db.close());for(const amount of [0,-1,1.001,Number.NaN])await assert.rejects(()=>f.service.apply(f.target,amount));
 await assert.rejects(()=>f.service.apply({...f.target,invoiceId:'local-sale-id'},10));assert.equal(f.requests.length,0);assert.equal((f.db.prepare('SELECT count(*) n FROM pos_fiscal_credit_applications_v1').get() as any).n,0);
});
