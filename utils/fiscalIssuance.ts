import type {BusinessConfig,FiscalAllocation,FiscalRangeDGII,FiscalIssuanceSnapshot,LocalFiscalBuffer,Transaction} from '../types';
import {formatFiscalNumber} from './fiscalNumber';
export const snapshotFiscalIssuance=(business:BusinessConfig,range:FiscalRangeDGII,allocation:FiscalAllocation,buffer:LocalFiscalBuffer,ncf:string):FiscalIssuanceSnapshot=>{
 if(buffer.fiscalRangeId!==range.id||buffer.allocationId!==allocation.id||allocation.fiscalRangeId!==range.id
   ||formatFiscalNumber(buffer.type,buffer.prefix,buffer.currentNumber)!==ncf
   ||buffer.currentNumber<allocation.reservedStart||buffer.currentNumber>allocation.reservedEnd
   ||buffer.currentNumber<range.startNumber||buffer.currentNumber>range.endNumber)throw Error('FISCAL_ISSUANCE_AUTHORITY_REQUIRED');
 const terminal=business.terminals?.find(row=>row.id===buffer.terminalId||row.config?.erpTerminalId===buffer.terminalId);
 const binding=terminal?.config?.erpBinding;
 return {schemaVersion:1,source:'POS_FISCAL_RESERVATION_V1',ncf,ncfType:buffer.type,sequence:buffer.currentNumber,
   fiscalRangeId:range.id,fiscalAllocationId:allocation.id,prefix:buffer.prefix,rangeStart:range.startNumber,rangeEnd:range.endNumber,
   allocationStart:allocation.reservedStart,allocationEnd:allocation.reservedEnd,expiryDate:range.expiryDate||null,
   issuerRnc:String(business.companyInfo?.rnc||'').replace(/\D/g,'')||null,tenantId:binding?.tenantId||null,
   companyId:binding?.companyId||null,terminalId:buffer.terminalId!,capturedAt:new Date().toISOString()};
};
export const assertFiscalIssuance=(tx:Partial<Transaction>):void=>{
 const snapshot=tx.fiscalIssuance;if(!snapshot)return; // Historical documents remain immutable; no fabricated recovery.
 if(snapshot.schemaVersion!==1||snapshot.source!=='POS_FISCAL_RESERVATION_V1'||snapshot.ncf!==tx.ncf||snapshot.ncfType!==tx.ncfType
   ||!snapshot.terminalId||!snapshot.fiscalRangeId||!snapshot.fiscalAllocationId
   ||formatFiscalNumber(snapshot.ncfType,snapshot.prefix,snapshot.sequence)!==snapshot.ncf
   ||snapshot.sequence<snapshot.rangeStart||snapshot.sequence>snapshot.rangeEnd
   ||snapshot.sequence<snapshot.allocationStart||snapshot.sequence>snapshot.allocationEnd)throw Error('FISCAL_ISSUANCE_SNAPSHOT_INVALID');
};
