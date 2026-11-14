import test from 'node:test';
import assert from 'node:assert/strict';
import {returnFixture} from './fiscalReturnConsumerFixture';
import {id} from './articleFormatsNativeFixture';
import {returnJSON,RETURN_CREDIT_PATH} from '../services/fiscal/FiscalReturnV1';
import {createHash} from 'node:crypto';
const capability={schemaVersion:1 as const,enabled:true,defaultDestination:'ORIGINAL_PAYMENT' as const,destinations:['ORIGINAL_PAYMENT','CUSTOMER_CREDIT'] as any,requiresEmptyPayments:true as const,creditApplicationPath:RETURN_CREDIT_PATH};
async function setup(destination:'ORIGINAL_PAYMENT'|'CUSTOMER_CREDIT',debt=0,mixed=false){
 const f=await returnFixture();f.setCapability({settlement:capability});
 f.setProofTransform(p=>{const s=p.returnSnapshot,total=s.total,budget=Math.round((total-debt)*100)/100;
  const funding=budget?[{id:id(901),methodId:mixed?'CARD':'CASH',method:mixed?'CARD':'CASH',amount:mixed?Math.round(budget*40)/100:budget,currency:'DOP'},...(mixed?[{id:id(902),methodId:'CASH',method:'CASH',amount:Math.round(budget*60)/100,currency:'DOP'}]:[])]:[];
  Object.assign(s,{erpCustomerId:id(903),pendingBalance:debt,paidAmount:destination==='ORIGINAL_PAYMENT'?budget:0,paymentCommands:destination==='ORIGINAL_PAYMENT'?funding:[],liquidityTargets:destination==='ORIGINAL_PAYMENT'?funding.map(p=>({paymentId:p.id,methodId:p.methodId,accountCode:'AUTHORIZED',amount:p.amount})):[],settlement:{schemaVersion:1,destination,currency:'DOP',total,debtReduction:debt,refundAmount:destination==='ORIGINAL_PAYMENT'?budget:0,customerCreditAmount:destination==='CUSTOMER_CREDIT'?budget:0,customerId:id(903),advanceAccount:destination==='CUSTOMER_CREDIT'?'AUTHORIZED_ADVANCE':null,fundingPayments:funding}});
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
 assert.equal(f.documents('wallet_transactions').length,0);assert.equal(f.documents('cashMovements').length,0);
 assert.equal((await f.run()).id,tx.id);assert.equal(f.documents('internalSequences').find(s=>s.documentType==='REFUND').nextNumber,2);
});
