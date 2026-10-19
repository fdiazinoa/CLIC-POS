import type {TerminalConfig,Transaction} from '../../types';
import {resolveLocalDeviceId} from '../../utils/deviceRevocation';
import {readTerminalCredentialsSync} from '../sync/TerminalCredentialStore';
import {fiscalWorkflowScopeKey,type FiscalWorkflowCheckoutV2,type FiscalWorkflowScope} from './FiscalWorkflowV2Types';
/** Identity-only reconciliation of an already committed receipt. No session renewal or new permit. */
export function readFiscalWorkflowLocalScope(terminal:TerminalConfig|undefined,terminalId:string,readCredentials=readTerminalCredentialsSync,readDevice=resolveLocalDeviceId):FiscalWorkflowScope{
 const credentials=readCredentials(),deviceId=readDevice(),binding=terminal?.erpBinding;
 const scope={tenantId:binding?.tenantId,companyId:binding?.companyId,storeId:binding?.storeId,terminalId:terminal?.erpTerminalId||terminalId,deviceId};
 if(Object.values(scope).some(value=>typeof value!=='string'||!value)
  ||(credentials.erpTenantId||credentials.tenantId)!==scope.tenantId
  ||(credentials.erpTerminalId||credentials.terminalId)!==scope.terminalId
  ||credentials.companyId!==scope.companyId||credentials.storeId!==scope.storeId
  ||credentials.deviceId!==deviceId||terminal?.currentDeviceId!==deviceId)throw Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
 return scope as FiscalWorkflowScope;
}
export function assertFiscalWorkflowCheckoutReplay(checkout:FiscalWorkflowCheckoutV2,source:Transaction,cartIdentity:string,scope:FiscalWorkflowScope):void{
 const formatBirth=(source as any).articleFormatWire?.fiscal?.birth;
 const checkoutId=source.fiscalWorkflowCheckoutId||formatBirth?.checkoutId;
 if(!['COMMITTED','ACKNOWLEDGED'].includes(checkout.phase)||checkout.scopeKey!==fiscalWorkflowScopeKey(scope)
  ||checkout.cartIdentity!==cartIdentity||source.id!==checkout.transactionId||source.terminalId!==scope.terminalId
  ||checkoutId!==checkout.checkoutId||!checkout.permit||checkout.permit.transactionId!==source.id
  ||fiscalWorkflowScopeKey(checkout.permit.scope)!==fiscalWorkflowScopeKey(scope))throw Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
 let cart:any;try{cart=JSON.parse(cartIdentity);}catch{throw Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');}
 if((source.customerId||null)!==(cart.customerId||null)||source.ncfType!==cart.fiscalType)throw Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
}
