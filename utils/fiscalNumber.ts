import type { FiscalDocumentCode } from '../types';
const codes=/^(?:B(?:01|02|04|14|15)|E(?:31|32|34|44|45))$/;
export const fiscalSequencePadding=(type:FiscalDocumentCode):number=>{
 if(!codes.test(type)) throw Error('FISCAL_DOCUMENT_TYPE_INVALID');
 return type.startsWith('E')?10:8;
};
/** Strict NEW issuance only. Never normalize historical record identity. */
export const formatFiscalNumber=(type:FiscalDocumentCode,prefix:string,sequence:number):string=>{
 const width=fiscalSequencePadding(type);
 if(prefix!==type || !Number.isSafeInteger(sequence)||sequence<1||sequence>10**width-1) throw Error('FISCAL_SEQUENCE_INVALID');
 return prefix+String(sequence).padStart(width,'0');
};
