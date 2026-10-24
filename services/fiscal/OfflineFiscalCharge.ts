import type {BusinessConfig,Transaction} from '../../types';
import {calculateUncoveredServiceChargeBase} from '../../utils/fiscalBreakdown';
import {resolveAppliedServiceTaxPolicy} from '../../utils/serviceTaxPolicy';

/** Header algebra is separate from retained table ownership. This is not an authority grant. */
export const hasOfflineFiscalHeader=(source:Partial<Transaction>):boolean=>Boolean(source.fiscalWorkflowCheckoutId&&(source.fiscalAllocationAuthorizationId||source.fiscalOfflineLeaseId));

/** Reuse the existing policy and line algebra; a caller cannot authorize its own charge snapshot. */
export function assertDirectFiscalCharge(source:Partial<Transaction>,config:BusinessConfig):void {
 const charge=source.serviceChargeAmount??0;
 if(charge===0)return;
 const fail=():never=>{throw Error('OFFLINE_FISCAL_DIRECT_TIP_INVALID');};
 if(typeof charge!=='number'||!Number.isFinite(charge)||charge<0||!source.items?.length||!source.serviceType)fail();
 const terminals=config.terminals.filter(row=>row.id===source.terminalId||row.config.erpTerminalId===source.terminalId);
 if(terminals.length!==1)fail();
 const policy=resolveAppliedServiceTaxPolicy(config,terminals[0].config,source.serviceType!);
 if(policy.legalTip?.enabled!==true||policy.legalTip.percentage!==10||JSON.stringify(source.serviceTaxPolicySnapshot)!==JSON.stringify(policy))fail();
 const base=calculateUncoveredServiceChargeBase(source.items!,config,{discountAmount:source.discountAmount||0,
  isTaxIncluded:source.items![0].v3SaleAuthority?.taxIncluded===true,terminalConfig:terminals[0].config,
  taxExempt:source.customerSnapshot?.isTaxExempt===true,allowedTaxIds:policy.taxIds});
 if(Math.abs(charge-Math.round((base*.1+Number.EPSILON)*100)/100)>.01)fail();
}
