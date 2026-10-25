import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDirectFiscalCharge,hasOfflineFiscalHeader} from '../services/fiscal/OfflineFiscalCharge';
import {calculateUncoveredServiceChargeBase} from '../utils/fiscalBreakdown';
import {resolveAppliedServiceTaxPolicy} from '../utils/serviceTaxPolicy';

test('direct charge reuses exact policy/base for tax-inclusive, exempt and discounted sources',()=>{
 for(const taxIncluded of [false,true])for(const exempt of [false,true])for(const discountAmount of [0,10]){
  const config:any={terminals:[{id:'T',config:{financial:{serviceTaxPolicies:{DINE_IN:{taxIds:['VAT'],legalTip:{enabled:true,percentage:10}}}}}}],taxes:[{id:'VAT',name:'VAT',type:'VAT',rate:.18}]};
  const policy=resolveAppliedServiceTaxPolicy(config,config.terminals[0].config,'DINE_IN');
  const items:any=[{id:'P',price:taxIncluded?118:100,quantity:1,taxable:true,appliedTaxIds:['VAT'],v3SaleAuthority:{taxIncluded}}];
  const base=calculateUncoveredServiceChargeBase(items,config,{discountAmount,isTaxIncluded:taxIncluded,terminalConfig:config.terminals[0].config,taxExempt:exempt,allowedTaxIds:policy.taxIds});
  const source:any={terminalId:'T',items,serviceType:'DINE_IN',serviceTaxPolicySnapshot:policy,serviceChargeAmount:Math.round(base*10)/100,discountAmount,customerSnapshot:{isTaxExempt:exempt}};
  assert.doesNotThrow(()=>assertDirectFiscalCharge(source,config));
  assert.throws(()=>assertDirectFiscalCharge({...source,serviceChargeAmount:source.serviceChargeAmount+1},config));
  const disabled=structuredClone(config);disabled.terminals[0].config.financial.serviceTaxPolicies.DINE_IN.legalTip.enabled=false;
  assert.throws(()=>assertDirectFiscalCharge(source,disabled));
 }
 assert.equal(hasOfflineFiscalHeader({fiscalWorkflowCheckoutId:'fake'}),false);
 assert.equal(hasOfflineFiscalHeader({fiscalWorkflowCheckoutId:'id',fiscalAllocationAuthorizationId:'allocation'}),true);
});
