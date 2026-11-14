import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveRefundFiscalReservation} from '../services/fiscal/RefundFiscalReservation';

test('E34 never degrades to legacy or an unprepared allocation birth',async()=>{
 for(const originalTransactionId of [undefined,'original']){
  let calls=0;await assert.rejects(reserveRefundFiscalReservation({refundFiscalType:'E34',originalTransactionId,items:[],terminalId:'T',activeTerminalConfig:{},
   client:{reserveOfflineCheckout:async()=>{calls++;return {allocation:{ncf:'E340000000001'}};}},db:{reserveFiscalNumber:async()=>{calls++;return {ncf:'E340000000001'};}}}),/FISCAL_RETURN_PREPARATION_REQUIRED/);assert.equal(calls,0);
 }
});
test('B04 keeps the existing reservation contract and retry identity',async()=>{
 let calls=0;const result=await reserveRefundFiscalReservation({refundFiscalType:'B04',originalTransactionId:'original',retryKey:'retry',retryFingerprint:'fingerprint',items:[],terminalId:'T',activeTerminalConfig:{},
 db:{reserveFiscalNumber:async(type,terminal,count,_config,key,fingerprint)=>{calls++;assert.equal(type,'B04');assert.equal(terminal,'T');assert.equal(count,1);assert.equal(key,'retry');assert.equal(fingerprint,'fingerprint');return {ncf:'B0400000001',fiscalIssuance:{ncf:'B0400000001'}};}}});assert.equal(calls,1);assert.equal(result.ncf,'B0400000001');
});
