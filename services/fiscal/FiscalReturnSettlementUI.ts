import {canOfferReturnSettlement} from '../../utils/returnSettlementEligibility';
import type {Transaction,Customer} from '../../types';
import {dbAdapter} from '../db';
import {apiSyncAdapter} from '../sync/ApiSyncAdapter';
import {resolveSyncTarget} from '../sync/SyncProfile';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {createFiscalReturnTransport} from './FiscalReturnConsumer';
import {returnNeed,type ReturnSettlementDestination} from './FiscalReturnV1';
export async function loadReturnSettlementSelection(source:Transaction){
 const auth=captureFiscalStatusBoundContext(),{tenantId,companyId,storeId,terminalId,deviceId}=auth.descriptor,scope={tenantId,companyId,storeId,terminalId,deviceId};
 const attempt=await dbAdapter.fiscalReturnStore?.active(scope,source.id);auth.assertCurrent();
 const intent=attempt?JSON.parse(attempt.intent):null,command=attempt?.commandBytes?JSON.parse(attempt.commandBytes):null;
 const durable=command?command.settlement:attempt?.settlementSelection||intent?.settlementRequested||intent?.settlement;
 const capability=await createFiscalReturnTransport().capability();auth.assertCurrent();
 const enabled=canOfferReturnSettlement(source,capability,scope);
 let customerId:string|null=null;
 if(enabled&&source.customerId&&resolveSyncTarget().kind==='ERP_ACTIVE'){
  const rows=await apiSyncAdapter.pull('customers') as Customer[];auth.assertCurrent();
  const matches=rows.filter(c=>c.id===source.customerId||c.source_customer_id===source.customerId||c.sourceCustomerId===source.customerId);
  if(matches.length===1&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(matches[0].id))customerId=matches[0].id;
 }
 if(durable?.destination==='CUSTOMER_CREDIT'&&attempt?.preparation?.returnSnapshot.settlement?.customerId)customerId=attempt.preparation.returnSnapshot.settlement.customerId;
 returnNeed(!durable||durable.schemaVersion===1&&['ORIGINAL_PAYMENT','CUSTOMER_CREDIT'].includes(durable.destination),'FISCAL_RETURN_IDEMPOTENCY_CONFLICT');
 return {enabled:enabled&&(!attempt||Boolean(durable)),destination:(durable?.destination||'ORIGINAL_PAYMENT') as ReturnSettlementDestination,locked:Boolean(attempt),customerId,
  prepared:attempt?.preparation?.returnSnapshot.settlement,requestedLines:intent?.lines,reason:intent?.reason,legacyPending:Boolean(attempt&&!durable)};
}
