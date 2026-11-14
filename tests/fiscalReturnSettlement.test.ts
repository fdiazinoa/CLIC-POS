import {verifyReturnSettlementPresentation,returnSettlementLines} from '../services/fiscal/ReturnSettlementPresentation';
import {buildReceiptEmailPayload} from '../services/email/receiptEmailPayload';
import test from 'node:test';
import assert from 'node:assert/strict';
import {returnFixture} from './fiscalReturnConsumerFixture';
import {id} from './articleFormatsNativeFixture';
import {returnJSON,RETURN_CREDIT_PATH} from '../services/fiscal/FiscalReturnV1';
import {createHash} from 'node:crypto';
const capability={schemaVersion:1 as const,enabled:true,defaultDestination:'ORIGINAL_PAYMENT' as const,destinations:['ORIGINAL_PAYMENT','CUSTOMER_CREDIT'] as any,requiresEmptyPayments:true as const,creditApplicationPath:RETURN_CREDIT_PATH};
async function setup(destination:'ORIGINAL_PAYMENT'|'CUSTOMER_CREDIT',debt=0,mixed=false,alter?:(p:any)=>void){
 const f=await returnFixture();f.setCapability({settlement:capability});
 f.original.customerId=id(903);f.original.pendingBalance=debt;
 f.original.payments=[{...f.original.payments[0],amount:10-debt},...(debt?[{id:id(904),method:'CREDIT',amount:debt} as any]:[])];
 for(const collection of ['transactions','transactionHistory'])f.db.prepare('UPDATE documents SET data=? WHERE collection_name=? AND doc_id=?').run(JSON.stringify(f.original),collection,f.original.id);
 await f.adapter.saveDocument('customers',{id:id(903),name:'Synthetic buyer',currentDebt:debt,wallet:{id:'existing-wallet',customerId:id(903),currency:'DOP',status:'ACTIVE',balance:20}});

 f.setProofTransform(p=>{const s=p.returnSnapshot,total=s.total,budget=Math.round((total-debt)*100)/100;
  const funding=budget?[{id:id(901),methodId:mixed?'CARD':'CASH',method:mixed?'CARD':'CASH',amount:mixed?Math.round(budget*40)/100:budget,currency:'DOP'},...(mixed?[{id:id(902),methodId:'CASH',method:'CASH',amount:Math.round(budget*60)/100,currency:'DOP'}]:[])]:[];
  Object.assign(s,{sourceCustomerId:id(903),erpCustomerId:id(903),pendingBalance:debt,paidAmount:destination==='ORIGINAL_PAYMENT'?budget:0,paymentCommands:destination==='ORIGINAL_PAYMENT'?funding:[],liquidityTargets:destination==='ORIGINAL_PAYMENT'?funding.map(p=>({paymentId:p.id,methodId:p.methodId,accountCode:'AUTHORIZED',amount:p.amount})):[],settlement:{schemaVersion:1,destination,currency:'DOP',total,debtReduction:debt,refundAmount:destination==='ORIGINAL_PAYMENT'?budget:0,customerCreditAmount:destination==='CUSTOMER_CREDIT'?budget:0,customerId:id(903),advanceAccount:destination==='CUSTOMER_CREDIT'?'AUTHORIZED_ADVANCE':null,fundingPayments:funding}});
  alter?.(p);
  p.returnSnapshotDigestInput=returnJSON({schemaVersion:1,source:'ERP_POS_FISCAL_RETURN_V1',value:s});p.returnSnapshotDigest=createHash('sha256').update(p.returnSnapshotDigestInput).digest('hex');return p;
 });
 const run=async()=>{
  return f.client.process(f.original,f.original.items,new Map([['line','SELLABLE']]),'Synthetic return',id(10),{id:'user',name:'User'},destination);
 };
 return {...f,run};
}

for(const scenario of [
 {destination:'ORIGINAL_PAYMENT',debt:0,mixed:false},
 {destination:'ORIGINAL_PAYMENT',debt:4,mixed:true},
 {destination:'ORIGINAL_PAYMENT',debt:10,mixed:false},
 {destination:'CUSTOMER_CREDIT',debt:0,mixed:false},
 {destination:'CUSTOMER_CREDIT',debt:4,mixed:false},
] as const)test(`sealed ${scenario.destination} debt ${scenario.debt} commits only authorized monetary events`,async t=>{
 const f=await setup(scenario.destination,scenario.debt,scenario.mixed);t.after(()=>f.cleanup());const tx=await f.run();
 assert.equal(tx.pendingBalance,scenario.debt);assert.equal(tx.returnSettlementV1?.destination,scenario.destination);
 assert.deepEqual(JSON.parse(f.prepareCalls[0]).payments,[]);assert.equal(JSON.parse(f.prepareCalls[0]).settlement.destination,scenario.destination);
 const events=f.db.prepare('SELECT event_type,payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[];
 assert.deepEqual(events.map(e=>e.event_type),scenario.destination==='ORIGINAL_PAYMENT'&&scenario.debt<10?['SALES_CREDIT_NOTE_POSTED','PAYMENT_POSTED']:['SALES_CREDIT_NOTE_POSTED']);
 assert.equal(f.documents('customers')[0].currentDebt,0);assert.equal(f.documents('customers')[0].wallet.balance,20);
 assert.equal(f.documents('wallet_transactions').length,0);assert.equal(f.documents('cashMovements').length,0);
 assert.equal((await f.run()).id,tx.id);assert.equal(f.documents('internalSequences').find(s=>s.documentType==='REFUND').nextNumber,2);
});

test('explicit ORIGINAL intent never silently downgrades after flag OFF, nor changes mode after lost prepare',async t=>{
 const f=await setup('ORIGINAL_PAYMENT');t.after(()=>f.cleanup());f.setCapability({settlement:{...capability,enabled:false}});
 await assert.rejects(f.run,/SETTLEMENT_DISABLED/);const attempt=JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
 assert.equal(JSON.parse(attempt.intent).settlementRequired,true);assert.equal(f.prepareCalls.length,0);f.setCapability({settlement:capability});f.setLosePrepare();await assert.rejects(f.run);
 await assert.rejects(()=>f.client.process(f.original,f.original.items,new Map([['line','SELLABLE']]),'Synthetic return',id(10),{id:'user',name:'User'},'CUSTOMER_CREDIT'),/IDEMPOTENCY_CONFLICT/);
 const tx=await f.run();assert.equal(JSON.parse(f.prepareCalls[0]).operationId,attempt.operationId);assert.equal(tx.returnSettlementV1?.destination,'ORIGINAL_PAYMENT');
});
for(const [name,alter]of [
 ['wrong sum',(p:any)=>p.returnSnapshot.settlement.customerCreditAmount++],
 ['wrong customer',(p:any)=>p.returnSnapshot.settlement.customerId=id(999)],
 ['cash invented',(p:any)=>p.returnSnapshot.paymentCommands.push({id:id(990),method:'CASH',methodId:'CASH',amount:1,currency:'DOP'})],
] as const)test(`holds sealed response with ${name} before native effects`,async t=>{
 const f=await setup('CUSTOMER_CREDIT',4,false,alter);t.after(()=>f.cleanup());await assert.rejects(f.run);assert.equal(f.documents('inventoryLedger').length,0);assert.equal(f.documents('internalSequences').find(s=>s.documentType==='REFUND').nextNumber,1);
});
for(const kind of ['amount','nonRETURN'] as const)test(`native guard rejects ${kind} source settlement forgery`,async t=>{
 const f=await setup('CUSTOMER_CREDIT');t.after(()=>f.cleanup());f.setCommitTransform(tx=>({...tx,...(kind==='nonRETURN'?{documentType:'TICKET' as const}:{returnSettlementV1:{...tx.returnSettlementV1!,customerCreditAmount:999}})}));await assert.rejects(f.run);assert.equal(f.documents('inventoryLedger').length,0);
});
test('commercial credit print/email uses sealed authorization, never funding CASH, including reprint validation',async t=>{
 const f=await setup('CUSTOMER_CREDIT',4);t.after(()=>f.cleanup());const tx=await f.run();assert.throws(()=>returnSettlementLines(tx),/RECEIPT_REQUIRED/);
 await verifyReturnSettlementPresentation(tx,f.adapter.fiscalReturnStore);const lines=returnSettlementLines(tx);assert.ok(lines.includes('Aplicado a deuda factura original: DOP 4.00'));assert.ok(lines.includes('Saldo a favor del cliente: DOP 6.00'));assert.ok(lines.includes('Sin entrega de efectivo/banco'));assert.ok(!lines.some(l=>l.includes('CASH')));
 const email=buildReceiptEmailPayload(tx,'synthetic@example.invalid',f.config,'RD$');assert.deepEqual(email.returnSettlementLines,lines);assert.deepEqual(email.payments,[]);
 await verifyReturnSettlementPresentation(tx,f.adapter.fiscalReturnStore);assert.deepEqual(returnSettlementLines(tx),lines);
 for(const changed of [{...tx,ncf:'E349999999999'},{...tx,customerName:'Different customer'},{...tx,payments:[{id:id(991),method:'CASH',amount:999}]}] as any[])assert.throws(()=>returnSettlementLines(changed),/RECEIPT_REQUIRED/);
 await assert.rejects(()=>verifyReturnSettlementPresentation({...tx,returnSettlementV1:{...tx.returnSettlementV1!,customerCreditAmount:999}},f.adapter.fiscalReturnStore),/SOURCE_MISMATCH/);
});

test('applied debt-only RETURN queues scoped projection outside commit, accepts ERP wallet null without fabricating one',async t=>{
 const f=await setup('ORIGINAL_PAYMENT',10);t.after(()=>f.cleanup());const customer=f.documents('customers')[0];delete customer.wallet;
 f.db.prepare("UPDATE documents SET data=? WHERE collection_name='customers' AND doc_id=?").run(JSON.stringify(customer),customer.id);
 const tx=await f.run(),events=f.db.prepare('SELECT event_id FROM sync_outbox_v2').all() as any[];
 assert.equal(f.documents('fiscalReturnProjectionRequests').length,0);
 for(const e of events){f.db.prepare("UPDATE sync_outbox_v2 SET status='APPLIED_ERP' WHERE event_id=?").run(e.event_id);await f.adapter.fiscalReturnStore.acknowledgeApplied(e.event_id);}
 const request=f.documents('fiscalReturnProjectionRequests')[0];assert.equal(request.state,'PENDING');assert.equal(request.transactionId,tx.id);
 const {createFiscalCreditApplicationService}=await import('../services/fiscal/FiscalReturnCreditApplication');
 const service=createFiscalCreditApplicationService({store:()=>f.adapter.fiscalCreditApplicationStore,context:(()=>({descriptor:f.scope,assertCurrent:()=>{}})) as any,
 capability:async()=>{throw Error('no capability write');},consult:async()=>{throw Error('no consult');},customers:async()=>[{id:customer.id,name:'Synthetic buyer',currentDebt:0}],getCustomer:id=>f.adapter.getDocument('customers',id),getWallet:id=>f.adapter.getDocument('wallets',id),getWallets:()=>f.adapter.getCollection('wallets'),post:async()=>{throw Error('no credit debit');},notify:()=>{}});
 await service.refreshReturn(request);assert.equal(f.documents('fiscalReturnProjectionRequests')[0].state,'REFRESHED');assert.equal(f.documents('wallets').length,0);assert.equal(f.documents('wallet_transactions').length,0);
});
