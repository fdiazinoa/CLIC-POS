import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RefundModal} from '../components/RefundModal';
import {canOfferReturnSettlement,isOrdinaryElectronicReturnSource} from '../utils/returnSettlementEligibility';
import {RETURN_PROFILE,RETURN_CREDIT_PATH} from '../services/fiscal/FiscalReturnV1';
import type {Transaction} from '../types';
const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'};
const capability:any={schemaVersion:1,version:1,capability:'fiscalReturnV1',profile:RETURN_PROFILE,enabled:true,ready:true,operationKind:'RETURN',ncfType:'E34',birthSchemaVersion:3,eventSchemaVersion:1,scope,bindingAuthorityHash:'a'.repeat(64),authorizationId:'00000000-0000-4000-8000-000000000001',authorityHash:'b'.repeat(64),environment:0,issuerRnc:'101010101',requiresOnlinePreparation:true,readiness:{admission:true,recovery:true,bank:true},transport:{requiresPreservedOuterContract:true,batch:{enabled:true,path:'/api/sync/inbox/batch'}},settlement:{schemaVersion:1,enabled:true,defaultDestination:'ORIGINAL_PAYMENT',destinations:['ORIGINAL_PAYMENT','CUSTOMER_CREDIT'],requiresEmptyPayments:true,creditApplicationPath:RETURN_CREDIT_PATH}};
const source=(code:string)=>({id:'source',ncf:code+'0000000001',ncfType:code,fiscalMode:code.startsWith('E')?'ECF':'LEGACY_B',documentType:'TICKET',status:'COMPLETED',items:[],payments:[],total:10} as unknown as Transaction);
for(const code of ['E31','E32','E44','E45'])test(`${code} ordinary UI offers only admitted original/customer-credit settlement and labels E34`,()=>{
 const tx=source(code);assert.equal(isOrdinaryElectronicReturnSource(tx),true);assert.equal(canOfferReturnSettlement(tx,capability,scope),true);
 assert.equal(capability.settlement.defaultDestination,'ORIGINAL_PAYMENT');assert.ok(capability.settlement.destinations.includes('CUSTOMER_CREDIT'));
 const html=renderToStaticMarkup(React.createElement(RefundModal,{isOpen:true,onClose:()=>{},onConfirm:async()=>{},transaction:tx,currencySymbol:'RD$'}));
 assert.match(html,/Nota de Crédito Fiscal \(E34\)/);assert.match(html,/Importe seleccionado de la devolución/);assert.doesNotMatch(html,/Nota de Crédito Fiscal \(B04\)/);
 assert.equal(canOfferReturnSettlement(tx,{...capability,settlement:{...capability.settlement,enabled:false}},scope),false);
 assert.equal(canOfferReturnSettlement(tx,{...capability,ready:false},scope),false);
});
test('legacy, formats, gateway and refund documents do not enter ordinary settlement UI',()=>{
 for(const tx of [source('B02'),{...source('E44'),articleFormatWire:{schema_version:2}},{...source('E45'),documentType:'REFUND'},source('E34')]){
  assert.equal(isOrdinaryElectronicReturnSource(tx as Transaction),false);assert.equal(canOfferReturnSettlement(tx as Transaction,capability,scope),false);
 }
 assert.equal(isOrdinaryElectronicReturnSource(source('E44'),'AZUL_GATEWAY_REFUND'),false);
});
