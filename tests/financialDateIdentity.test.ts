import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {financialIdentity,financialOperationIdentity} from '../services/db/LargeMasterSyncV3FinancialRetention';
const original=()=>({id:'date-sale',documentType:'TICKET',total:710.4,netAmount:555,taxAmount:99.9,serviceChargeAmount:55.5,v3WarehouseId:'warehouse',restaurantOrderId:'account',restaurantTableId:'table',payments:[{id:'cash',method:'CASH',amount:710.4,timestamp:new Date('2026-10-23T06:39:12.403-04:00')}],nested:[{at:new Date('2026-10-23T10:39:13.007Z')}]} as any);
test('shared financial identity canonicalizes native Date recursively to persisted ISO without mutating source',()=>{
 const source=original(),timestamp=source.payments[0].timestamp,wire=JSON.parse(JSON.stringify(source));
 assert.equal(financialIdentity(source),financialIdentity(wire));assert.equal(financialOperationIdentity(source,'warehouse',{}),financialOperationIdentity(wire,'warehouse',{}));
 assert.strictEqual(source.payments[0].timestamp,timestamp);assert.equal(timestamp.toISOString(),'2026-10-23T10:39:12.403Z');
 assert.equal(JSON.parse(financialIdentity(source)).nested[0].at,'2026-10-23T10:39:13.007Z');
 const later=original();later.payments[0].timestamp=new Date(timestamp.getTime()+1);assert.notEqual(financialIdentity(source),financialIdentity(later));
});
test('Date intrinsics ignore instance overrides; existing ISO literals and object ordering remain literal',()=>{
 const source=original();let calls=0;source.payments[0].timestamp.toISOString=()=>{calls++;throw Error('override');};source.payments[0].timestamp.toJSON=()=>{calls++;throw Error('override');};source.payments[0].timestamp.getTime=()=>NaN;
 assert.equal(JSON.parse(financialIdentity(source)).payments[0].timestamp,'2026-10-23T10:39:12.403Z');assert.equal(calls,0);
 const custom:any={b:2,a:1};Object.defineProperty(custom,'toJSON',{value:()=>{calls++;throw Error('unexpected callback');},enumerable:false});
 assert.equal(financialIdentity({value:custom} as any),'{"value":{"a":1,"b":2}}');assert.equal(calls,0);
 source.payments[0].timestamp='2026-10-23T06:39:12.403-04:00';assert.equal(JSON.parse(financialIdentity(source)).payments[0].timestamp,source.payments[0].timestamp);
});
test('invalid native Date rejects while financial mutations remain protected and ACK metadata remains excluded',()=>{
 const source=original();source.payments[0].timestamp=new Date(NaN);assert.throws(()=>financialIdentity(source),/SYNC_V3_FINANCIAL_DATE_INVALID/);
 const valid=original(),identity=financialIdentity(valid);assert.equal(financialIdentity({...valid,status:'SYNCED',fiscalStatus:'ACCEPTED',relatedTransactions:['ack']}),identity);
 assert.notEqual(financialIdentity({...valid,total:711}),identity);assert.notEqual(financialIdentity({...valid,payments:[{...valid.payments[0],amount:711}]}),identity);
});
test('reservation-specific sequence omissions and refund-original identity keep their established semantics',()=>{
 const source={...original(),v3ReservationClaimId:'claim',globalSequence:1,displayId:'1',seriesNumber:1};
 assert.equal(financialIdentity(source),financialIdentity({...source,globalSequence:2,displayId:'2',seriesNumber:2}));
 const refund={...original(),id:'refund'};assert.equal(financialOperationIdentity(refund,'warehouse',{refund:true,original:original()}),financialOperationIdentity(JSON.parse(JSON.stringify(refund)),'warehouse',{refund:true,original:JSON.parse(JSON.stringify(original()))}));
});
test('wire JSON fingerprint matches unchanged actual ERP production implementation',{skip:!process.env.CLIC_ERP_SOURCE_ROOT},async()=>{
 const {v3OperationFingerprint}=await import(pathToFileURL(process.env.CLIC_ERP_SOURCE_ROOT+'/server/services/fiscal/posFiscalV3Source.js').href);
 const source=original();assert.equal(financialOperationIdentity(source,'warehouse',{}),v3OperationFingerprint(JSON.parse(JSON.stringify(source))));
});
