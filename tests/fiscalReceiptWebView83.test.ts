import test from 'node:test';
import assert from 'node:assert/strict';
import {wireFixture} from './helpers/fiscalAppliedReceiptFixture';
import {captureFiscalOutboxAnchors,validateAppliedReceiptV2} from '../services/fiscal/FiscalAppliedReceiptV2';
import {requireFiscalErpAppliedReceipt} from '../services/fiscal/FiscalMSellerDispatch';
test('receipt strict own keys work without ES2022 Object.hasOwn; inherited, null and undefined remain denied; production HOLD unchanged',async()=>{
 const wire=wireFixture(),tx=wire.originalSource.transaction,row=wire.materializedSnapshot.sources[0];
 const anchors=captureFiscalOutboxAnchors([{event_id:row.event_id,event_type:row.event_type,aggregate_type:'TRANSACTION',aggregate_id:tx.id,schema_version:1,payload_json:JSON.stringify(row.payload.erp_fiscal_v3_application_plan_v1.originalPayload)}],tx.id);
 const descriptor=Object.getOwnPropertyDescriptor(Object,'hasOwn');Object.defineProperty(Object,'hasOwn',{value:undefined,configurable:true,writable:true});
 try {
  await validateAppliedReceiptV2(wire.expectedResponse,anchors,wire.expectedResponse.scope,tx);
  for(const bad of [null,undefined,{...wire.expectedResponse,source:undefined},{...wire.expectedResponse,extra:true},Object.assign(Object.create({source:wire.expectedResponse.source}),Object.fromEntries(Object.entries(wire.expectedResponse).filter(([key])=>key!=='source')))])await assert.rejects(()=>validateAppliedReceiptV2(bad,anchors,wire.expectedResponse.scope,tx),/FISCAL_/);
  await assert.rejects(()=>requireFiscalErpAppliedReceipt(tx),/FISCAL_ERP_APPLIED_RECEIPT_REQUIRED/);
 }finally{if(descriptor)Object.defineProperty(Object,'hasOwn',descriptor);else delete (Object as any).hasOwn;}
});
