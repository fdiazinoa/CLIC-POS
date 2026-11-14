import type {Transaction} from '../types';
import type {FiscalWorkflowScope} from '../services/fiscal/FiscalWorkflowV2Types';
import {assertReturnSettlementCapability,type ReturnCapability} from '../services/fiscal/FiscalReturnV1';
/** UI routing only. ERP capability, original proof and preparation remain the admission authority. */
export const isElectronicFiscalDocument=(source:Transaction):boolean=>source.fiscalMode==='ECF'||/^E\d{2}/.test(source.electronicNcf||source.ncf||source.ncfType||'');
export function isOrdinaryElectronicReturnSource(source:Transaction|null,mode='STANDARD'):boolean {
 if(!source||mode==='AZUL_GATEWAY_REFUND'||(source as any).articleFormatWire)return false;
 const kind=String(source.documentType||(source as any).type||'').toUpperCase();
 return isElectronicFiscalDocument(source)&&!['REFUND','NOTA_CREDITO','NC'].includes(kind)&&!/^E34/.test(source.electronicNcf||source.ncf||source.ncfType||'');
}
export function canOfferReturnSettlement(source:Transaction,capability:ReturnCapability,scope:FiscalWorkflowScope):boolean {
 if(!isOrdinaryElectronicReturnSource(source))return false;
 try{assertReturnSettlementCapability(capability,scope);return true;}catch{return false;}
}
