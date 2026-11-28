import { markSettingsReturnQa, measureSettingsReturnQa } from '../../settingsReturnQaTrace';
import {validOrdinaryReturnReference,originalReferencePendingCode} from './FiscalReturnV1';
import {verifyReturnStatus,returnStatusMessage} from './FiscalReturnStatus';
import type {DispatchFiscalPreparation} from '../db/DispatchFiscalPreparation';
type DispatchCheckoutPreparation=Pick<DispatchFiscalPreparation,'poolId'|'demandDigest'|'source'|'demands'>;
import {assertDopFiscalSettlement} from './DopFiscalSettlement';
import { setModifierQuantitiesSupported } from '../../utils/modifierQuantitiesCapability';
import type {OfflineFiscalAllocation} from './OfflineFiscalAllocation';
import {cartDigest,isExpiredPrepared,retirementReason,validateRetirementReceipt} from './FiscalWorkflowRetirement';
import {fiscalWorkflowScopeKey} from './FiscalWorkflowV2Types';
import type {FiscalRetirementProof,FiscalRetirementRecord} from './FiscalWorkflowV2Types';
import {matchesPreparedRecovery,hasPreparedSalePermit} from './FiscalWorkflowCheckoutRecovery';
import {hasFiscalWorkflowCapability,observeFiscalWorkflowCapability} from './FiscalWorkflowV2Capability';
import type {Transaction} from '../../types';
import {dbAdapter} from '../db';
import {createUuid} from '../../utils/uuid';
import {financialIdentity} from '../db/LargeMasterSyncV3FinancialRetention';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {fiscalStatusSourceChecksum} from './FiscalStatusProof';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import {readOfflineFiscalLocalAuthority,offlineFiscalSessionState} from './OfflineFiscalLeaseContext';
import {recordCheckoutTrace} from '../audit/CheckoutTrace';
import {notifyOfflineFiscalReserveDegraded} from './OfflineFiscalReconciliation';
import {validateOfflineFiscalLease,validateOfflineFiscalPermit,type OfflineFiscalLease,type TableFiscalSaleContext} from './OfflineFiscalLease';
import type {FiscalWorkflowCheckoutV2,FiscalWorkflowPermitV2,FiscalWorkflowScope,FiscalWorkflowStateV2,FiscalWorkflowPreparedRecovery} from './FiscalWorkflowV2Types';
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])):value;
const json=(value:any)=>JSON.stringify(canonical(value));
const fail=(code='FISCAL_WORKFLOW_PROOF_INVALID'):never=>{throw Error(code);};
const redactFiscalDiagnostic=(value:string):string=>value.replace(/(sync_|dev_)[A-Za-z0-9_\-]{8,}/g,'$1…').slice(0,200);
/** Keeps the real transport/storage cause for QA; the fiscal decision stays fail-closed. */
const preparationDiagnostic=(error:unknown):string=>redactFiscalDiagnostic(error instanceof Error?`${error.name}: ${error.message}`:String(error));
/** The ERP rejects a persisted issuance operation after lease rotation (409) or because the lease behind
 * it was revoked. They are recoverable ONCE by rotating `pos_fiscal_refill_v2.operation_id`; never loop. */
const REFILL_ROTATION_CODES=/^(FISCAL_OFFLINE_LEASE_OPERATION_REUSED|FISCAL_OFFLINE_LEASE_REVOKED|FISCAL_OFFLINE_AUTHORITY_CHANGED|FISCAL_OFFLINE_BINDING_CHANGED|FISCAL_OFFLINE_MASTER_REQUIRED)$/;
const REFILL_ROTATION_DELAY_MS=250;
const scopeOf=(descriptor:FiscalWorkflowScope):FiscalWorkflowScope=>({tenantId:descriptor.tenantId,companyId:descriptor.companyId,storeId:descriptor.storeId,terminalId:descriptor.terminalId,deviceId:descriptor.deviceId});
const contexts=(scope:FiscalWorkflowScope,other:FiscalWorkflowScope)=>json(scope)===json(other);
export async function verifyFiscalWorkflowState(source:Transaction,state:FiscalWorkflowStateV2,attempt?:import('./FiscalReturnV1').ReturnAttempt|null):Promise<boolean>{
 if(source.ncfType==='E34'&&!(source as any).articleFormatWire||state?.sourceKind==='RETURN_SOURCE_V1')return verifyReturnStatus(source,state,attempt===undefined?await dbAdapter.fiscalReturnStore?.byTransaction(source.id)||null:attempt);
 if(!state||state.schemaVersion!==2||state.source!=='ERP_POS_FISCAL_WORKFLOW_V2'||!['WORKFLOW','STATUS_ONLY'].includes(state.mode)||source.id!==state.transactionId||source.terminalId!==state.scope?.terminalId||source.ncf!==state.ncf||source.ncfType!==state.ncfType||source.total!==state.total||state.currency!=='DOP'||state.exchangeRate!==1||!Number.isSafeInteger(state.observationVersion)||state.observationVersion<0||!Number.isSafeInteger(state.draftRevision)||state.draftRevision<0||!['PENDING','ACCEPTED','ACCEPTED_CONDITIONAL','REJECTED'].includes(state.decision)||!Number.isFinite(Date.parse(state.observedAt)))return false;
 const envelope=state.originalSourceEnvelope;
 if(state.sourceKind==='FORMAT_SOURCE_V2')return verifyFormatWorkflowSource(source,state);
 if(envelope?.event)return false;
 const original=envelope?.transaction as Transaction;
 if(!original||financialIdentity(original)!==financialIdentity(source)||await fiscalStatusSourceChecksum(source)!==state.checksumV1)return false;
 if(original.currency==='DOP')try{assertDopFiscalSettlement(original);}catch{return false;}
 const f=original.fiscalIssuance;
 if(!f||f.issuerRnc!==state.issuerRnc||f.tenantId!==state.scope.tenantId||f.companyId!==state.scope.companyId||f.terminalId!==state.scope.terminalId||original.fiscalEnvironment!==state.environment||(original.currency||original.settlementCurrencyCode)!==state.currency)return false;
 const digest=await sha256Utf8(json({schemaVersion:2,source:'POS_ORIGINAL_ENVELOPE_V2',scope:state.scope,saleEventId:state.saleEventId,payload:envelope}));
 if(digest!==state.originalDigestV2)return false;
 if(state.mode==='STATUS_ONLY'&&(state.workflowId!==null||state.permitId!==null||state.canCorrect||state.draftRevision!==0))return false;
 if(state.sourceKind==='ORDINARY_SOURCE_V2'&&state.operationKind==='SALE'&&state.originalReference!=null&&!validOrdinaryReturnReference(source,state))return false;
 return true;
}
async function verifyFormatWorkflowSource(source:Transaction,state:FiscalWorkflowStateV2):Promise<boolean>{
 try{
  const {validateWireEventV2}=await import('../articleFormats/v2'),event=validateWireEventV2(state.originalSourceEnvelope?.event),local=(source as any).articleFormatWire;
  if(state.mode!=='WORKFLOW'||state.checksumV1!==null||!local||json(event)!==json(local)||event.transaction_id!==source.id||event.event_id!==state.saleEventId||!contexts(scopeOf(event.fiscal.permit.scope),state.scope)||event.fiscal.ncf!==state.ncf||event.fiscal.ncf_type!==state.ncfType||event.fiscal.issuer_rnc!==state.issuerRnc||event.fiscal.environment!==state.environment||event.fiscal.permit.permitId!==state.permitId||state.workflowId!==state.permitId||Number(event.totals.total_amount)!==state.total||Number(event.totals.net_amount)!==source.netAmount||Number(event.totals.tax_amount)!==source.taxAmount||Number(event.totals.discount_amount)!==Number(source.discountAmount||0)||source.items.length!==event.lines.length||source.payments.length!==event.payments.length)return false;
  const sign=event.event_type==='ARTICLE_FORMAT_SALE_V2'?1:-1;
  for(const line of event.lines){const matches=source.items.filter(l=>l.cartId===line.line_id);if(matches.length!==1)return false;const l=matches[0] as any;
   if(l.id!==line.item_id||l.quantity!==sign*Number(line.commercial_quantity)||l.baseQuantity!==sign*Number(line.base_quantity)||l.price!==Number(line.commercial_unit_price)||json(l.articleFormat)!==json(line.article_format)||json(l.formatWireLine)!==json(line))return false;}
  for(const p of event.payments){const found=source.payments.filter(x=>x.id===p.payment_id);if(found.length!==1||found[0].amount!==Number(p.amount)||String(found[0].method).toLowerCase()!==p.method)return false;}
  if(event.fiscal.birth.transactionId!==source.id||event.fiscal.birth.permitId!==state.permitId)return false;
  const digest=await sha256Utf8(json({schemaVersion:2,source:'POS_ORIGINAL_ENVELOPE_V2',scope:state.scope,saleEventId:state.saleEventId,payload:{event}}));
  return digest===state.originalDigestV2;
 }catch{return false;}
}
export interface FiscalDiagnosticsSnapshot {
 authStatus:string;scope:string;session:string;enabled:boolean;offlineReady:boolean;readiness:string;
 attempt:string;payments:string;paymentIntents:string;erpRetirement:string;binding:string;lease:string;lastError:string;
 attemptAuthority:'V2_ALLOCATION'|'V1_OFFLINE_LEASE'|'ERP_PERMIT'|'NO_CONTRACT'|null;
 /** Effective downloaded reserve, not the historical permit count. */
 reserveKind:'V2_ALLOCATION'|'V1_LEASE'|'NONE';reserveAvailable:boolean;reserveReason:string;
 bindingHash:string;recordBindingHash:string;transport:string;
}
const LOCAL_SIGNING_PREFERENCE_QA = import.meta.env?.VITE_POS_FISCAL_LOCAL_SIGNING_QA === 'true';
const LOCAL_SIGNING_PROBE_INTERVAL_MS = 60_000;
const LOCAL_SIGNING_PROBE_TIMEOUT_MS = 2_000;

export function createFiscalWorkflowV2Client({localSigningProbeEnabled=LOCAL_SIGNING_PREFERENCE_QA,readAuth=captureFiscalStatusBoundContext,readOfflineAuthority=readOfflineFiscalLocalAuthority,fetchImpl=fetch,prepareDispatch=(input:DispatchFiscalPreparation)=>{if(!dbAdapter.prepareDispatchFiscalCheckout)throw Error('DISPATCH_NATIVE_ATOMIC_CHECKOUT_REQUIRED');return dbAdapter.prepareDispatchFiscalCheckout(input);},store=()=>dbAdapter.fiscalWorkflowStore,readSource=async(id:string)=>await dbAdapter.getDocument<Transaction>('transactions',id)||await dbAdapter.getDocument<Transaction>('transactionHistory',id)}={}){
 let offlinePrefetch:Promise<void>|null=null;
 const retirements=new Map<string,Promise<FiscalRetirementRecord>>();
 const refills=new Map<string,Promise<void>>();const inFlight=new Map<string,Promise<FiscalWorkflowStateV2>>();let cursor='',generation=0;let currentAuthority:{fingerprint:string;authorityHash:string;expires:number}|null=null;
 let leasePreparationError:string|null=null,allocationPreparationError:string|null=null,allocationPrefetch:Promise<void>|null=null;
 let discovering:{key:string;promise:Promise<void>}|null=null;
 const authorityFingerprint=(auth:ReturnType<typeof readAuth>)=>json([auth.base,auth.headers,(auth as any).fingerprint||null]);
 const authorityFor=(auth:ReturnType<typeof readAuth>)=>currentAuthority?.fingerprint===authorityFingerprint(auth)&&currentAuthority.expires>Date.now()?currentAuthority.authorityHash:undefined;
 /** Stable identity hash, or a legacy hash accepted because the native store proved the same fiscal
  * identity from the downloaded grant. Session/transport state never participates. */
 const bindingCompatible=async(native:ReturnType<typeof store>,storedHash:string|null|undefined,authority:any):Promise<boolean>=>{
  if(storedHash===authority.bindingHash)return true;
  try{return Boolean(storedHash&&native?.offlineBindingCompatible&&await native.offlineBindingCompatible(storedHash,authority));}catch{return false;}
 };
 /** Only an explicit ERP withdrawal signal may retire downloaded authority; it is scoped to this
  * terminal's fiscal identity and leaves a support trace. Session or local mismatches never land here. */
 const withdrawErpAuthority=async(kind:'allocation'|'lease',code:string):Promise<void>=>{
  const native=store();if(!native)return;
  let local;try{local=await readOfflineAuthority();}catch{return;}
  const key=fiscalWorkflowScopeKey(local.scope);
  if(kind==='allocation')await native.revokeAllocations?.(key);else await native.revokeOfflineLeases?.(key);
  recordCheckoutTrace('OFFLINE_RESERVE_QUARANTINED',`ERP retiró la autorización ${kind}: ${code}`);
 };
 /** The ERP retirement proves document coverage; it legitimately takes longer than a command. */
const RETIREMENT_TIMEOUT_MS = 30_000;
/** The ERP allocates against Supabase and can exceed 8 s while the database reconnects. */
const ALLOCATION_TIMEOUT_MS = 25_000;

const request=async(path:string,body?:Record<string,any>,signal?:AbortSignal,timeoutMs=8000)=>{
  const auth=readAuth();auth.assertCurrent();const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
  try{const response=await fetchImpl(`${auth.base}/fiscal/workflow/v2/${path}`,{method:body?'POST':'GET',headers:{...auth.headers,'x-pos-capabilities':'largeMasterSyncV3 fiscalReturnConsumerFinalE32',Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});const data=await response.json();auth.assertCurrent();if(!response.ok)fail(typeof data?.code==='string'?data.code:'FISCAL_WORKFLOW_UNAVAILABLE');if(JSON.stringify(data).length>600000)fail();return {data,auth};}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
 let lastLocalSigningProbe: {binding: string; at: number} | null = null;
 const probeLocalSigningPreference = (auth: ReturnType<typeof readAuth>) => {
  if (!localSigningProbeEnabled) return;
  const binding = authorityFingerprint(auth), at = performance.now(), epoch = generation;
  if (lastLocalSigningProbe?.binding === binding
    && at - lastLocalSigningProbe.at < LOCAL_SIGNING_PROBE_INTERVAL_MS) return;
  lastLocalSigningProbe = {binding, at};
  void measureSettingsReturnQa('fiscal.localSigningPreference', async () => {
   try {
    const {data, auth: responseAuth} = await request(
     'local-signing/v1/capability', undefined, undefined, LOCAL_SIGNING_PROBE_TIMEOUT_MS,
    );
    auth.assertCurrent();
    if (epoch !== generation || authorityFingerprint(responseAuth) !== binding) return;
    if (data?.schemaVersion !== 1 || data.capability !== 'fiscalLocalSigningV1'
      || typeof data.eligible !== 'boolean') throw Error('FISCAL_LOCAL_SIGNING_PREFERENCE_INVALID');
    markSettingsReturnQa(data.eligible ? 'fiscal.localSigningPreference.on' : 'fiscal.localSigningPreference.off');
   } catch {
    if (epoch !== generation) return;
    try { auth.assertCurrent(); } catch { return; }
    markSettingsReturnQa('fiscal.localSigningPreference.unavailable');
   }
  });
 };
 return {
 /** Reads the certificate identity for Android KeyChain. This does not authorize an operation. */
 async readLocalSigningCertificate(expectedIssuerRnc: string, expectedEnvironment: 0 | 1): Promise<string | null> {
  if (!localSigningProbeEnabled) return null;
  if (expectedEnvironment !== 0 && expectedEnvironment !== 1) fail('FISCAL_LOCAL_SIGNING_ENVIRONMENT_REQUIRED');
  if (!/^[0-9]{9}(?:[0-9]{2})?$/.test(expectedIssuerRnc)) fail('FISCAL_LOCAL_SIGNING_ISSUER_REQUIRED');
  const epoch = generation;
  const { data, auth } = await request(
   'local-signing/v1/certificate', undefined, undefined, LOCAL_SIGNING_PROBE_TIMEOUT_MS,
  );
  if (epoch !== generation) fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
  if (data?.schemaVersion === 1 && data.authorized === false && Object.keys(data).length === 2) return null;
  if (data?.schemaVersion !== 1 || data.authorized !== true || Object.keys(data).length !== 6
   || data.environment !== expectedEnvironment || data.issuerRnc !== expectedIssuerRnc
   || !contexts(data.scope, scopeOf(auth.descriptor))
   || typeof data.certificateSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.certificateSha256)) {
   fail('FISCAL_LOCAL_SIGNING_CERTIFICATE_PROOF_INVALID');
  }
  return data.certificateSha256;
 },
 /** Cached native policy shared by COBRAR and its precharge guard. Never acquires authority. */
 async checkoutFiscalStatus(type:string):Promise<{remaining:number;total:number;recovery?:boolean}|null>{
  const native = store();
  const local = await measureSettingsReturnQa('fiscal.localAuthority', readOfflineAuthority);
  const current = native && await measureSettingsReturnQa('fiscal.currentCheckout', () => native.currentCheckout(fiscalWorkflowScopeKey(local.scope)));
  if(current&&['PREPARED','EFFECT_POSSIBLE'].includes(current.phase)){
   if(!current.allocation&&!current.permit?.leaseId)return null; // Online/V1 permits retain their existing caller policy.
   if(!await bindingCompatible(native,current.offlineBindingHash,local))fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
   if(current.phase==='EFFECT_POSSIBLE'){
    if(!current.paymentIds.length||JSON.parse(current.cartIdentity).fiscalType!==type)fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
    if(current.allocation){if(!native?.allocationDraft)fail('OFFLINE_FISCAL_NATIVE_REQUIRED');await native!.allocationDraft!(current);}
    else if(current.permit?.leaseId){const lease=await native?.offlineLease?.(local,true,current.permit.leaseId),at=Date.parse(current.offlineEffectAt||'');if(!lease||lease.leaseId!==current.permit.leaseId||!Number.isFinite(at)||at<Date.parse(lease.issuedAt)||at>=Date.parse(lease.validUntil))fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');}
    else fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
    return {remaining:1,total:1,recovery:true};
   }
   if(current.permit?.leaseId)return null; // Existing V1 preparation keeps its legacy numbering policy.
   if(current.allocation){if(!native?.allocationDraft)fail('OFFLINE_FISCAL_NATIVE_REQUIRED');await native!.allocationDraft!(current);}
  }
  const allocation = native?.allocationAvailability && await measureSettingsReturnQa('fiscal.allocationAvailability', () => native.allocationAvailability!(local, type));
  if (!allocation) return null;
  return {remaining:allocation.remaining[type]||0,total:allocation.total?.[type]||allocation.remaining[type]||0};
 },
 async allocationReady(type?:string):Promise<boolean>{try{const value=await store()?.allocationAvailability?.(await readOfflineAuthority(),type);return Boolean(value&&Object.values(value.remaining).some(n=>n>0));}catch{return false;}},
 async offlineReadiness():Promise<{reason:string;code?:string;remaining?:Record<string,number>}>{
  try{const local=await readOfflineAuthority(),native=store(),current=await native?.currentCheckout(fiscalWorkflowScopeKey(local.scope));
   if(current?.allocation&&current.phase==='EFFECT_POSSIBLE'){await native?.allocationDraft?.(current);return {reason:'READY_ALLOCATION'};}
   const allocation=await measureSettingsReturnQa('fiscal.offlineReadinessAvailability', async () => native?.allocationAvailability?.(local));if(allocation)return {reason:Object.values(allocation.remaining).some(n=>n>0)?'READY_ALLOCATION':'FISCAL_RANGE_EXHAUSTED',remaining:allocation.remaining};
   if(await native?.offlineLease?.(local))return {reason:'READY_V1'};
   const leaseReason=await native?.offlineLeaseReason?.(local);if(leaseReason&&leaseReason!=='MISSING_AUTHORIZATION')return {reason:leaseReason};const preparationError=leasePreparationError||allocationPreparationError;
   return preparationError?{reason:/DISABLED/.test(preparationError)?'PREPARATION_DISABLED':'PREPARATION_FAILED',code:preparationError}:{reason:'MISSING_AUTHORIZATION'};
  }catch(error){const code=error instanceof Error?error.message:'OFFLINE_FISCAL_PREPARATION_FAILED';return {reason:/OPERATION_REUSED/.test(code)?'PREPARATION_RETRY_REQUIRED':/CLOCK_ROLLBACK/.test(code)?'CLOCK_ROLLBACK':/RANGE_EXPIRED/.test(code)?'FISCAL_RANGE_EXPIRED':/RANGE_EXHAUSTED/.test(code)?'FISCAL_RANGE_EXHAUSTED':/REVOKED/.test(code)?'AUTHORITY_REVOKED':'AUTHORITY_CHANGED',code};}
 },
 async prepareOfflineAuthority():Promise<void>{
  await this.prefetchOfflineAllocation().catch(()=>undefined);
  try{if(await store()?.offlineAllocation?.(await readOfflineAuthority()))return;}catch{/* V1 still checks its own unchanged authority. */}
  await this.prefetchOfflineLease();
 },
 async prefetchOfflineAllocation():Promise<void>{
  if(allocationPrefetch)return allocationPrefetch;
  allocationPrefetch=(async()=>{const native=store();if(!native?.saveAllocation)return;const local=await readOfflineAuthority(),epoch=generation,captured=readAuth();captured.assertCurrent();
   const operationKey=fiscalWorkflowScopeKey(local.scope)+'|allocation-v2|'+local.bindingHash,operationId=await native.refillOperation(operationKey);
   let response;try{response=await request('offline-allocation/authority',{schemaVersion:2,operationId},undefined,ALLOCATION_TIMEOUT_MS);}catch(error){if(error instanceof Error&&error.message==='FISCAL_ALLOCATION_OPERATION_RETIRED')await native.savePermits(operationKey,operationId,[]);throw error;}const {data}=response;
   if(data?.schemaVersion!==2||data.capability!=='OFFLINE_FISCAL_ALLOCATION_V2')fail('OFFLINE_FISCAL_ALLOCATION_INVALID');
   captured.assertCurrent();if(epoch!==generation||JSON.stringify(await readOfflineAuthority())!==JSON.stringify(local))fail('OFFLINE_FISCAL_BINDING_CHANGED');
   await native.saveAllocation(data.authorization as OfflineFiscalAllocation,local,data.serverTime);await native.savePermits(operationKey,operationId,[]);allocationPreparationError=null;
   if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('offlineFiscalReserveUpdated'));
  })().catch(async error=>{allocationPreparationError=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:error instanceof Error&&error.name==='AbortError'?'OFFLINE_FISCAL_PREPARATION_TIMEOUT':'OFFLINE_FISCAL_PREPARATION_FAILED';if(typeof console!=='undefined')console.warn('[fiscal] offline allocation preparation failed',preparationDiagnostic(error));const code=allocationPreparationError;
   if(/^(FISCAL_ALLOCATION_(AUTHORITY_CHANGED|MASTER_REQUIRED|RANGE_REQUIRED)|FISCAL_WORKFLOW_(SCOPE_CHANGED|DEVICE_CHANGED|ERP_ACTIVE_REQUIRED|ASSIGNMENT_REQUIRED|ISSUER_SCOPE_REQUIRED))$/.test(code))await withdrawErpAuthority('allocation',code);else notifyOfflineFiscalReserveDegraded(code);throw error;}).finally(()=>{allocationPrefetch=null;});return allocationPrefetch;
 },
 async allocationDraft(checkout:FiscalWorkflowCheckoutV2){const native=store();if(!native?.allocationDraft)fail('OFFLINE_FISCAL_NATIVE_REQUIRED');const draft=await native!.allocationDraft!(checkout);if(!checkout.allocation||![0,1,2].includes(draft.fiscalEnvironment)||checkout.allocation.environment!==undefined&&checkout.allocation.environment!==draft.fiscalEnvironment)fail('OFFLINE_FISCAL_SOURCE_AUTHORITY_CHANGED');checkout.allocation.environment=draft.fiscalEnvironment;return draft;},
 async offlineStatus():Promise<{remaining:number;validUntil:string|null;remainingByType?:Record<string,number>}|null>{try{const native=store(),local=await readOfflineAuthority(),allocation=await native?.allocationAvailability?.(local);if(allocation)return {remaining:Object.values(allocation.remaining).reduce((sum,n)=>sum+n,0),validUntil:null,remainingByType:allocation.remaining};if(!native?.offlineLease||!native.offlineLeasePermitCount)return null;const lease=await native.offlineLease(await readOfflineAuthority());return lease?{remaining:await native.offlineLeasePermitCount(lease.leaseId,true),validUntil:lease.validUntil}:null;}catch{return null;}},
 /** Identity-only receipt lookup: never renews a session or requires new issuance eligibility. */
 async localCheckoutForReceipt(scope:FiscalWorkflowScope,checkoutId?:string,accountId?:string,tableId?:string):Promise<FiscalWorkflowCheckoutV2|null>{
  const native=store(),key=fiscalWorkflowScopeKey(scope),checkout=checkoutId?await native?.readCheckout(checkoutId):accountId&&tableId?await native?.checkoutForTable?.(key,accountId,tableId):null;
  if(checkout&&checkout.scopeKey!==key)fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');return checkout||null;
 },
 async localCheckout(accountId?:string,tableId?:string):Promise<FiscalWorkflowCheckoutV2|null>{const authority=await readOfflineAuthority(),key=fiscalWorkflowScopeKey(authority.scope),native=store();return accountId&&tableId&&await native?.checkoutForTable?.(key,accountId,tableId)||await native?.currentCheckout(key)||null;},
 /** Asks the ERP to retire the pending attempt and records its answer. The ERP is the only
  * authority on whether a document exists: it refuses and nothing changes locally when it does. */
 async retireUnbornAttempt(operator?:{actorId:string;pin:string}):Promise<{retired:boolean;note:string}>{
  const native=store();if(!native?.closeUnbornRetirement)return {retired:false,note:'La caja no tiene almacén fiscal local.'};
  const auth=readAuth();auth.assertCurrent();
  const key=fiscalWorkflowScopeKey(scopeOf(auth.descriptor)),current=await native.currentCheckout(key);auth.assertCurrent();
  if(!current)return {retired:false,note:'No hay un intento fiscal pendiente.'};
  const id=current.checkoutId.slice(0,8);
  if(['COMMITTED','ACKNOWLEDGED'].includes(current.phase))return {retired:false,note:`El intento ${id} ya está cerrado (${current.phase}).`};
  if(!current.permit?.permitId)return {retired:false,note:`El intento ${id} no tiene permiso fiscal del ERP.`};
  const proof:FiscalRetirementProof={schemaVersion:1,commandId:createUuid(),checkoutId:current.checkoutId,transactionId:current.transactionId,
   permitId:current.permit.permitId,originalOperationId:current.operationId,cartIdentitySha256:await cartDigest(current.cartIdentity),reason:retirementReason};
  try{
   const {data}=await request('retire-unborn',{...proof,nonce:current.permit.nonce,...(operator||{})},undefined,RETIREMENT_TIMEOUT_MS);
   auth.assertCurrent();validateRetirementReceipt(data,proof,scopeOf(auth.descriptor));
   const closed=await native.closeUnbornRetirement!(key,proof,data);auth.assertCurrent();
   return {retired:true,note:`El ERP confirmó que el intento ${closed.checkoutId.slice(0,8)} nunca emitió comprobante y lo retiró.`};
  }catch(error){
   return {retired:false,note:`El ERP no retiró el intento ${id}: ${error instanceof Error?error.message:String(error)}. Verifícalo en el ERP antes de volver a cobrar.`};
  }
 },
 /** Supervised break-glass: the ERP retirement service answered that it is disabled, the
  * attempt has no local effects, and a supervisor authorized freeing the box. */
 async releasePendingAttempt(actor:string):Promise<{released:boolean;note:string}>{
  const native=store();if(!native?.releaseAttemptWithoutErp)return {released:false,note:'La caja no tiene almacén fiscal local.'};
  const auth=readAuth();auth.assertCurrent();
  const key=fiscalWorkflowScopeKey(scopeOf(auth.descriptor)),current=await native.currentCheckout(key);auth.assertCurrent();
  if(!current)return {released:false,note:'No hay un intento fiscal pendiente.'};
  const id=current.checkoutId.slice(0,8);
  if(!['PREPARED','EFFECT_POSSIBLE'].includes(current.phase))return {released:false,note:`El intento ${id} ya está cerrado (${current.phase}).`};
  // A tender the provider declined cannot hold money: it is the only payment a release may carry.
  const intents=native.intentStates?await native.intentStates(current.transactionId).catch(()=>[]):[];
  const unsettled=intents.filter(intent=>String(intent.status||'').toUpperCase()!=='DECLINED');
  if(unsettled.length)return {released:false,note:`El intento ${id} tiene cobros sin resolver (${unsettled.map(intent=>intent.status).join(', ')}). Confirma el voucher o regulariza el cobro antes de liberar.`};
  const releasedPayments=intents.map(intent=>intent.paymentId);
  try{await native.releaseAttemptWithoutErp(current,actor,{releasedPayments});return {released:true,note:`Se liberó la caja del intento ${id}. Queda registrado quién lo autorizó; verifica en el ERP que no exista comprobante para ese intento.`};}
  catch(error){return {released:false,note:`No se pudo liberar el intento ${id}: ${error instanceof Error?error.message:String(error)}`};}
 },
 /** Read-only snapshot of the fiscal attempt held by this terminal. Never mutates state. */
 async pendingCheckoutInfo():Promise<{checkoutId:string;phase:string;operationId:string;cartIdentity:string;payments:number;permitExpiresAt:string|null;permitId:string|null;offlineBindingHash:string|null;localBindingHash:string|null;leaseId:string|null}|null>{
  try{const auth=readAuth(),native=store();if(!native)return null;const current=await native.currentCheckout(fiscalWorkflowScopeKey(scopeOf(auth.descriptor)));
   if(!current)return null;const local=await readOfflineAuthority().catch(()=>null);
   return {checkoutId:current.checkoutId,phase:current.phase,operationId:current.operationId,cartIdentity:current.cartIdentity,payments:(current.paymentIds||[]).length,permitExpiresAt:current.permit?.expiresAt||null,permitId:current.permit?.permitId||null,offlineBindingHash:current.offlineBindingHash||null,localBindingHash:local?.bindingHash||null,leaseId:current.permit?.leaseId||null};
  }catch{return null;}
 },
 /** Releases an attempt that can never reconcile with the current cart or authority.
  * Only PREPARED attempts without payment effects are eligible; anything with a possible
  * effect is reported and left untouched for ERP verification. */
 async cancelUnreconcilableAttempt(options:{tags?:string[];cartIdentity?:string;operator?:{actorId:string;pin:string}}={}):Promise<{cancelled:boolean;note:string}>{
  const native=store();if(!native)return {cancelled:false,note:'La caja no tiene almacén fiscal local.'};
  const auth=readAuth();auth.assertCurrent();
  const key=fiscalWorkflowScopeKey(scopeOf(auth.descriptor)),current=await native.currentCheckout(key);auth.assertCurrent();
  if(!current)return {cancelled:false,note:'No hay un intento fiscal pendiente.'};
  const id=current.checkoutId.slice(0,8);
  if(['COMMITTED','ACKNOWLEDGED'].includes(current.phase))return {cancelled:false,note:`El intento ${id} ya está cerrado (${current.phase}).`};
  if(!['PREPARED','EFFECT_POSSIBLE'].includes(current.phase))return {cancelled:false,note:`El intento ${id} está en un estado que requiere revisión manual (${current.phase}).`};
  const tags=[...new Set((options.tags||[]).filter(Boolean))];
  const sameOperation=tags.length>0&&tags.every(tag=>tag===current.operationId);
  const local=await readOfflineAuthority().catch(()=>null);
  const sameBinding=Boolean(local&&await bindingCompatible(store(),current.offlineBindingHash,local));
  const expiresAt=Date.parse(current.permit?.expiresAt||'');
  const expired=Number.isFinite(expiresAt)&&expiresAt<=Date.now();
  const sameTicket=sameOperation&&(!options.cartIdentity||options.cartIdentity===current.cartIdentity)
   &&(!current.offlineBindingHash||sameBinding);
  if(sameTicket&&!expired)return {cancelled:false,note:`El intento ${id} corresponde a este mismo ticket.`};
  // 1. An offline-lease attempt never leaves the terminal: its own abandon proof is authoritative,
  //    even with a payment marked as possible, because the number is consumed by the local commit.
  if(current.permit?.leaseId&&native.abandonOfflinePrepared){
   try{await native.abandonOfflinePrepared(current);return {cancelled:true,note:`Se descartó el intento fiscal ${id} sin efectos.`};}catch{/* the paid offline release below */}}
  if(current.phase==='EFFECT_POSSIBLE'&&current.permit?.leaseId&&native.abandonPreparedWithoutEffects){
   try{await native.abandonPreparedWithoutEffects(current,{allowOfflineEffect:true});return {cancelled:true,note:`Se descartó el intento fiscal offline ${id} sin comprobante emitido.`};}
   catch(error){return {cancelled:false,note:`No se pudo descartar el intento ${id}: ${error instanceof Error?error.message:String(error)}`};}
  }
  // 2. An online PREPARED attempt with no effects is provably local too: release it here instead of
  //    depending on an ERP service that may be disabled.
  if(current.phase==='PREPARED'&&native.abandonPreparedWithoutEffects&&current.permit?.permitId){
   try{await native.abandonPreparedWithoutEffects(current);return {cancelled:true,note:`Se descartó el intento fiscal ${id} sin efectos.`};}catch{/* the ERP keeps the last word */}}
  // 3. A paid online attempt is only discardable by the ERP: it is the authority on the document.
  if(current.permit?.permitId){
   const retired=await this.retireUnbornAttempt(options.operator);
   if(retired.retired)return {cancelled:true,note:retired.note};
   const disabled=/FISCAL_WORKFLOW_(DISABLED|UNAVAILABLE)|HTTP_5\d\d/i.test(retired.note);
   const documented=/COMPROBANTE|DOCUMENT|EFFECT|ISSUED|BORN|EMITIDO/i.test(retired.note);
   if(current.phase==='EFFECT_POSSIBLE')return {cancelled:false,note:`${retired.note} El intento ya tiene un pago: no se puede descartar sin la confirmación del ERP.`};
   if(documented&&!disabled)return {cancelled:false,note:retired.note};
   return {cancelled:false,note:retired.note};
  }
  // 4. No permit at all and no effects.
  if(native.abandonPreparedWithoutEffects){
   try{await native.abandonPreparedWithoutEffects(current);return {cancelled:true,note:`Se descartó el intento fiscal ${id} sin efectos.`};}
   catch(error){
    // Fail-closed: the attempt may have reached the ERP. Keep the code in the console, not the cashier message.
    try{console.warn('[fiscal] release attempt held',id,error instanceof Error?error.message:String(error));}catch{}
    return {cancelled:false,note:'La reserva fiscal del intento anterior se está conciliando. Reintenta la operación pendiente; no se emitió ningún comprobante.'};
   }
  }
  return {cancelled:false,note:`El intento ${id} requiere verificación en el ERP antes de continuar.`};
 },
 /** What the deployed ERP says about its own fiscal workflow flags (read-only, no auth). */
 async erpDeployment():Promise<{onlineRetirement:string;host:string}>{
  try{const auth=readAuth();const response=await fetchImpl(`${auth.base}/version`,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',cache:'no-store',redirect:'error'});
   const data=await response.json().catch(()=>null);const flag=(data as any)?.fiscalWorkflowV2;
   if(flag&&typeof flag.retirement==='boolean')return {onlineRetirement:flag.retirement?'activo':'desactivado',host:String(auth.base||'')};
   return {onlineRetirement:'no informado',host:String(auth.base||'')};}catch{return {onlineRetirement:'sin respuesta',host:''};}
 },
 async diagnostics():Promise<FiscalDiagnosticsSnapshot>{
  const out:FiscalDiagnosticsSnapshot={authStatus:'',scope:'',session:'',enabled:false,offlineReady:false,readiness:'',attempt:'SIN INTENTO',payments:'SIN INTENTO',paymentIntents:'SIN INTENTO',erpRetirement:'sin consultar',binding:'',lease:'SIN RESERVA',lastError:leasePreparationError||allocationPreparationError||'',
   attemptAuthority:null,reserveKind:'NONE',reserveAvailable:false,reserveReason:'',bindingHash:'',recordBindingHash:'',transport:''};
  // A missing/expired session must not hide the local reserve: the screen is read-only evidence.
  try{const auth=readAuth();out.authStatus='OK';out.scope=`${auth.descriptor.storeId.slice(0,8)} · ${auth.descriptor.terminalId.slice(0,8)}`;const expiry=(auth as any).sessionExpiresAt;out.session=expiry?new Date(expiry).toLocaleString('es-DO'):'sin vencimiento';out.enabled=this.enabled();}catch(error){out.authStatus=error instanceof Error?error.message:String(error);out.session='sin sesión verificada';}
  try{const transportState=offlineFiscalSessionState();out.transport=transportState.verified?'Sesión local verificada':`Sesión sin verificar (${transportState.detail})`;}catch{out.transport='Sesión sin verificar';}
  try{const erp=await this.erpDeployment();out.erpRetirement=erp.onlineRetirement+(erp.onlineRetirement==='no informado'?' (versión del ERP anterior)':'');}catch{out.erpRetirement='sin respuesta';}
  try{const readiness=await this.offlineReadiness();out.readiness=`${readiness.reason}${readiness.code?` (${readiness.code})`:''}`;out.reserveReason=readiness.code?`${readiness.reason} (${readiness.code})`:readiness.reason;
   // A disabled optional feature is not an error when the local reserve is already ready.
   if(/READY/.test(readiness.reason))out.lastError='';}catch(error){out.readiness=error instanceof Error?error.message:String(error);}
  out.offlineReady=await this.offlineReady().catch(()=>false);
  try{const native=store(),local=await readOfflineAuthority().catch(()=>null);
   if(local&&native){
    const key=fiscalWorkflowScopeKey(local.scope),current=await native.currentCheckout(key).catch(()=>null);
    if(current){
     out.attempt=`${current.phase} · ${current.checkoutId.slice(0,8)} · ${(current.paymentIds||[]).length} pago(s)`;
     if(current.allocation)out.attemptAuthority='V2_ALLOCATION';
     else if(current.permit?.leaseId)out.attemptAuthority='V1_OFFLINE_LEASE';
     else if(current.permit?.permitId)out.attemptAuthority='ERP_PERMIT';
     else out.attemptAuthority='NO_CONTRACT';
    }
    // A bound payment intent is why a local release refuses an attempt with a payment. Payments taken
    // by the attempt and provider intents are different sources and are reported separately.
    out.payments=(current?.paymentIds||[]).length?current!.paymentIds.map(id=>id.slice(-6)).join(' · '):'sin pagos';
    if(current&&native.intentStates){const states=await native.intentStates(current.transactionId).catch(()=>[] as Array<{paymentId:string;status:string}>);
     out.paymentIntents=states.length?states.map(state=>`${state.paymentId.slice(-6)}:${state.status}`).join(' · '):'sin intentos de pago';}
    out.binding=local?'autoridad local OK':'sin autoridad local';
    if(current)out.binding+=current.offlineBindingHash?(await bindingCompatible(native,current.offlineBindingHash,local)?' · misma vinculación':' · vinculación anterior'):' · sin vinculación offline';
    out.bindingHash=local.bindingHash.slice(0,12);
    try{const hashes=await native.offlineReserveBindingHashes?.(local);out.recordBindingHash=[hashes?.lease?`V1 ${hashes.lease.slice(0,8)}`:null,hashes?.allocation?`V2 ${hashes.allocation.slice(0,8)}`:null].filter(Boolean).join(' · ');}catch{out.recordBindingHash='';}
    // Effective reserve: V2 allocation (remaining per type + window) first, then V1 lease (usable permits).
    const allocation:{authorizationId:string;remaining:Record<string,number>}|null=native.allocationAvailability?await native.allocationAvailability(local).catch(()=>null):null;
    if(allocation){
     const usable=Object.values(allocation.remaining).reduce((sum,value)=>sum+value,0);
     const grant=native.offlineAllocation?await native.offlineAllocation(local).catch(()=>null):null;
     const window=grant?.authority.allocations.map(member=>member.expiryDate).filter((value):value is string=>Boolean(value)).sort().pop()||null;
     out.reserveKind='V2_ALLOCATION';out.reserveAvailable=usable>0;
     out.lease=`Asignación ${allocation.authorizationId.slice(0,8)} · ${Object.entries(allocation.remaining).map(([type,value])=>`${type}: ${value}`).join(' · ')||'sin tipos'} usables${window?` · vence ${window}`:' · sin vencimiento propio'}`;
    }else{
     const lease=await native.offlineLease?.(local).catch(()=>null);
     if(lease){const available=await native.offlineLeasePermitCount?.(lease.leaseId,true)||0;
      out.reserveKind='V1_LEASE';out.reserveAvailable=available>0;
      out.lease=`Lease ${lease.leaseId.slice(0,8)} · ${available} de ${lease.saleCapacity} usables · hasta ${lease.validUntil}`;
     }else{
      const reason=await native.offlineLeaseReason?.(local).catch(()=>null);
      out.reserveKind='NONE';out.reserveAvailable=false;
      if(reason)out.reserveReason=reason;
      out.lease=`SIN RESERVA · ${out.reserveReason||'MISSING_AUTHORIZATION'}`;
     }
    }
   }else out.binding='sin autoridad local';
  }catch(error){out.binding=error instanceof Error?error.message:String(error);}
  return out;
 },
 async offlineReady():Promise<boolean>{const readiness=await this.offlineReadiness();if(readiness.reason==='READY_ALLOCATION')return true;try{const native=store();if(!native?.offlineLease)return false;const authority=await readOfflineAuthority();if(await native.offlineLease(authority))return true;const current=await native.currentCheckout(fiscalWorkflowScopeKey(authority.scope));return Boolean(current?.phase==='EFFECT_POSSIBLE'&&current.permit?.leaseId&&await bindingCompatible(native,current.offlineBindingHash,authority)&&Number.isFinite(Date.parse(current.offlineEffectAt||''))&&Date.parse(current.offlineEffectAt!)<Date.parse(current.permit.expiresAt));}catch{return false;}},
 prefetchOfflineLease():Promise<void>{
  if(offlinePrefetch)return offlinePrefetch;
  offlinePrefetch=(async()=>{
   const native=store();if(!native?.saveOfflineLeasePage||!native.offlineLease||!native.offlineLeasePermitCount)return;
   const authority=await readOfflineAuthority(),existing=await native.offlineLease(authority),epoch=generation;
   if(existing&&await native.offlineLeasePermitCount(existing.leaseId)===existing.saleCapacity
    &&await native.offlineLeasePermitCount(existing.leaseId,true)>Math.min(16,existing.saleCapacity/4))return;
   const captured=readAuth();captured.assertCurrent();
   const capability=(await request('offline-lease/capability',undefined,undefined,ALLOCATION_TIMEOUT_MS)).data;
   if(capability?.schemaVersion!==1||capability.capability!=='OFFLINE_FISCAL_LEASE_V1'||capability.version!==1
    ||!contexts(capability.scope,authority.scope)||capability.policy?.pageSize!==16)fail('OFFLINE_FISCAL_LEASE_DISABLED');
   const operationKey=fiscalWorkflowScopeKey(authority.scope)+'|offline-lease-v1';
   const loadPermitPages=async(operationId:string)=>{
    let leaseId:string|null=null,page=0;
    do{
     const {data}=await request('offline-lease/permits',{schemaVersion:1,operationId,leaseId,page});
     if(data?.schemaVersion!==1||!Array.isArray(data.permits)||data.permits.length>16||data.page!==page
      ||data.nextPage!==null&&data.nextPage!==page+1)fail('OFFLINE_FISCAL_LEASE_INVALID');
     const lease=data.lease as OfflineFiscalLease;validateOfflineFiscalLease(lease,authority);
     if(leaseId&&lease.leaseId!==leaseId||page>Math.ceil(lease.saleCapacity/16))fail('OFFLINE_FISCAL_LEASE_INVALID');
     for(const permit of data.permits)validateOfflineFiscalPermit(permit,lease);
     captured.assertCurrent();if(epoch!==generation||JSON.stringify(await readOfflineAuthority())!==JSON.stringify(authority))fail('OFFLINE_FISCAL_BINDING_CHANGED');
     // A revoked/rotated authority never yields a local page: the store validates the fiscal identity.
     await native.saveOfflineLeasePage(lease,data.permits,authority,data.serverTime);
     if(page===0&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('offlineFiscalReserveUpdated'));
     leaseId=lease.leaseId;page=data.nextPage;
    }while(page!==null);
   };
   let operationId=await native.refillOperation(operationKey);
   try{await loadPermitPages(operationId);}
   catch(error){
    const code=error instanceof Error?error.message:'';
    if(!REFILL_ROTATION_CODES.test(code))throw error;
    // Explicit ERP authority signals retire the local grant first; the 409 only reuses an operation id.
    // Either way the persisted operation rotates and the pages are requested exactly once more.
    if(/^FISCAL_OFFLINE_(LEASE_REVOKED|AUTHORITY_CHANGED|BINDING_CHANGED|MASTER_REQUIRED)$/.test(code))await withdrawErpAuthority('lease',code);
    if(!native.rotateRefillOperation)throw error;
    recordCheckoutTrace('OFFLINE_RESERVE_QUARANTINED',`refill rotate ${code}`);
    await native.rotateRefillOperation(operationKey);
    await new Promise(resolve=>setTimeout(resolve,REFILL_ROTATION_DELAY_MS));
    operationId=await native.refillOperation(operationKey);
    await loadPermitPages(operationId);
   }
   await native.savePermits(operationKey,operationId,[]);leasePreparationError=null;
   if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('offlineFiscalReserveUpdated'));
  })().catch(async error=>{leasePreparationError=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:error instanceof Error&&error.name==='AbortError'?'OFFLINE_FISCAL_PREPARATION_TIMEOUT':'OFFLINE_FISCAL_PREPARATION_FAILED';if(typeof console!=='undefined')console.warn('[fiscal] offline lease preparation failed',preparationDiagnostic(error));const code=leasePreparationError;
   // Explicit ERP lease withdrawal is authoritative and durable; anything else is quarantined in memory
   // and reconciled online without destroying a reserve whose fiscal identity did not change.
   if(/^(FISCAL_OFFLINE_(LEASE_REVOKED|BINDING_CHANGED|AUTHORITY_CHANGED|MASTER_REQUIRED)|OFFLINE_FISCAL_LEASE_REVOKED)$/.test(code))await withdrawErpAuthority('lease',code);else notifyOfflineFiscalReserveDegraded(code);throw error;}).finally(()=>{offlinePrefetch=null;});return offlinePrefetch;
 },
 async reserveReturnCheckout(cartIdentity:string,operationId:string):Promise<FiscalWorkflowCheckoutV2>{
  const native=store();
  if(!native?.reserveAllocationCheckout)fail('OFFLINE_FISCAL_NATIVE_REQUIRED');
  const authority=await readOfflineAuthority();
  return native!.reserveAllocationCheckout!(authority,cartIdentity,operationId);
 },
 async reserveOfflineCheckout(cartIdentity:string,operationId:string,fiscalSaleContext?:TableFiscalSaleContext,dispatch?:DispatchCheckoutPreparation):Promise<FiscalWorkflowCheckoutV2>{
  const native=store();if(!native?.offlineLease)fail('OFFLINE_FISCAL_NATIVE_REQUIRED');
  const authority=await readOfflineAuthority(),scopeKey=fiscalWorkflowScopeKey(authority.scope);let current=await native.currentCheckout(scopeKey);
  // An existing paid attempt keeps its original kind, even when a new authority is downloaded.
  const isNewAfterAcknowledged = current?.phase === 'ACKNOWLEDGED' && current.operationId !== operationId;
  if(current?.allocation||(!current||isNewAfterAcknowledged)&&await native.allocationAvailability?.(authority)){
   if(!native.reserveAllocationCheckout)fail('OFFLINE_FISCAL_NATIVE_REQUIRED');
   return dispatch?prepareDispatch({...dispatch,cartIdentity,operationId,fiscal:{kind:'ALLOCATION',authority,context:fiscalSaleContext}}):native.reserveAllocationCheckout!(authority,cartIdentity,operationId,fiscalSaleContext);
  }
  let requestedOperation=operationId;
  if(!current&&await native.abandonedOfflineOperation?.(scopeKey,operationId))requestedOperation=createUuid();
  if(current?.phase==='PREPARED'&&current.permit?.leaseId&&(current.cartIdentity!==cartIdentity||JSON.stringify(current.fiscalSaleContext)!==JSON.stringify(fiscalSaleContext))){
   if(!native.abandonOfflinePrepared)fail('OFFLINE_FISCAL_ABANDON_NOT_SAFE');
   try{await native.abandonOfflinePrepared(current);}catch(error){const proof=await native.abandonedOfflineOperation?.(scopeKey,current.operationId);if(!proof||JSON.stringify(proof)!==JSON.stringify(current))throw error;}current=null;requestedOperation=createUuid();
  }
  const paidRecovery=current?.phase==='EFFECT_POSSIBLE'&&current.operationId===requestedOperation&&current.cartIdentity===cartIdentity;
  const lease=await native.offlineLease(authority,paidRecovery,paidRecovery?current!.permit?.leaseId:undefined);if(!lease)fail('OFFLINE_FISCAL_LEASE_REQUIRED');
  let expectedCurrent:FiscalWorkflowPreparedRecovery|undefined;
  if(current?.phase==='PREPARED'&&current.operationId!==operationId){
   expectedCurrent={scopeKey,checkoutId:current.checkoutId,transactionId:current.transactionId,operationId:current.operationId,cartIdentity,phase:'PREPARED',paymentIds:[]};
   if(!matchesPreparedRecovery(current,expectedCurrent)||current.permit?.leaseId!==lease.leaseId||current.permit.authorityHash!==lease.authorityHash)fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
  }
  const chosenOperation=expectedCurrent?.operationId||requestedOperation;
  const reserveOptions={requirePermit:true,authorityHash:lease.authorityHash,offline:{authority,leaseId:lease.leaseId,...(paidRecovery?{allowPaidRecovery:true}:{}),...(fiscalSaleContext?{fiscalSaleContext}:{})},...(expectedCurrent?{expectedCurrent}:{})};
  const checkout=dispatch?await prepareDispatch({...dispatch,cartIdentity,operationId:chosenOperation,fiscal:{kind:'PERMIT',scopeKey,options:reserveOptions}}):await native.reserveCheckout(scopeKey,cartIdentity,undefined,chosenOperation,reserveOptions);
  if(JSON.stringify(await readOfflineAuthority())!==JSON.stringify(authority))fail('OFFLINE_FISCAL_BINDING_CHANGED');
  return checkout;
 },
 enabled(){try{const auth=readAuth();auth.assertCurrent();return hasFiscalWorkflowCapability(auth.base,auth.headers);}catch{return false;}},
 invalidate(){generation++;cursor='';currentAuthority=null;lastLocalSigningProbe=null;},
 discover():Promise<void>{
  let auth:ReturnType<typeof readAuth>;try{auth=readAuth();auth.assertCurrent();}catch(error){return Promise.reject(error);}
  probeLocalSigningPreference(auth);
  if(hasFiscalWorkflowCapability(auth.base,auth.headers))return Promise.resolve();
  const key=authorityFingerprint(auth),epoch=generation;if(discovering?.key===key)return discovering.promise;
  const promise=(async()=>{
   const {data}=await request('capability');auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
   const keys=['schemaVersion','capability','version','scope','authorityHash','sessionExpiresAt'];
   // One additive, optional field: the ERP announces it accepts modifier quantities.
   const optional=['modifierQuantities'];
   const now=Date.now();
   // An open-ended session declares no date; a declared date must still be in the future.
   const current=(value:unknown)=>value==null||value===''||typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now;
   const lifetime=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Math.max(0,Date.parse(value)-now):300000;
   const expires=data?.sessionExpiresAt,localExpires=(auth as any).sessionExpiresAt||data?.sessionExpiresAt;
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!keys.includes(k)&&!optional.includes(k))||keys.some(k=>!Object.prototype.hasOwnProperty.call(data,k))
    ||data.schemaVersion!==2||data.capability!=='fiscalWorkflowV2'||data.version!==2||!contexts(data.scope,scopeOf(auth.descriptor))
    ||!current(expires)||!/^[a-f0-9]{64}$/.test(data.authorityHash)||!current(localExpires))fail();
   if(data.modifierQuantities!==undefined&&data.modifierQuantities!==1)fail();
   setModifierQuantitiesSupported(data.modifierQuantities===1);
   // Discovery grants availability only. The normal permit response must still prove its own authority.
   observeFiscalWorkflowCapability(auth.base,auth.headers,'2',now,Math.min(300000,lifetime(expires),lifetime(localExpires)));
  })().finally(()=>{if(discovering?.promise===promise)discovering=null;});discovering={key,promise};return promise;
 },
 prefetch():Promise<void>{
  if(!this.enabled())return Promise.resolve();
  const captured=readAuth(),refillKey=authorityFingerprint(captured),epoch=generation,existing=refills.get(refillKey);if(existing)return existing;
  const refill=(async()=>{
   const native=store();if(!native)return;const auth=captured,key=json(scopeOf(auth.descriptor));
   for(let attempt=0;attempt<2;attempt++){
    const operationId=await native.refillOperation(key);auth.assertCurrent();
    if(currentAuthority?.fingerprint===authorityFingerprint(auth))currentAuthority=null;
    const {data}=await request('permits',{operationId,capability:'fiscalWorkflowV2'});
    if(data?.schemaVersion!==2||!Array.isArray(data.permits)||data.permits.length>16||!/^[a-f0-9]{64}$/.test(data.authorityHash)
      ||(data.refillRequired!==undefined&&typeof data.refillRequired!=='boolean')||data.refillRequired&&data.permits.length)fail();
    if(currentAuthority?.fingerprint===authorityFingerprint(auth)&&currentAuthority.authorityHash!==data.authorityHash)currentAuthority=null;
    for(const permit of data.permits as FiscalWorkflowPermitV2[])if(permit.schemaVersion!==2||!contexts(permit.scope,scopeOf(auth.descriptor))
      ||!/^\d{9}(?:\d{2})?$/.test(permit.issuerRnc)||!Number.isFinite(Date.parse(permit.expiresAt))||Date.parse(permit.expiresAt)<=Date.now()
      ||!permit.transactionId||!permit.permitId||!permit.nonce||permit.authorityHash!==data.authorityHash||permit.state&&permit.state!=='PERMIT')fail();
    auth.assertCurrent();if(epoch!==generation||!hasFiscalWorkflowCapability(auth.base,auth.headers))fail('FISCAL_WORKFLOW_DISABLED');
    await native.savePermits(key,operationId,data.permits);auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_DISABLED');
    if(data.refillRequired){currentAuthority=null;continue;}
    currentAuthority={fingerprint:authorityFingerprint(auth),authorityHash:data.authorityHash,expires:Date.now()+300000};return;
   }
   fail('FISCAL_WORKFLOW_PERMIT_REQUIRED');
  })().finally(()=>{refills.delete(refillKey);});refills.set(refillKey,refill);return refill;
 },
 /** A checkout left by a previous terminal binding can never be completed here: its permit
  *  belongs to the old authority. Retire it through the ERP (`retire-unborn`), which refuses
  *  when a document already exists. */
 async retireStaleBindingCheckout():Promise<FiscalRetirementRecord|null>{
  const auth=readAuth(),epoch=generation;auth.assertCurrent();const native=store();if(!native?.retirement||!native.offlineLease)return null;
  const key=fiscalWorkflowScopeKey(scopeOf(auth.descriptor)),current=await native.currentCheckout(key);auth.assertCurrent();
  if(!current||!current.permit?.permitId||!current.offlineBindingHash)return null;
  let local;try{local=await readOfflineAuthority();}catch{return null;}
  if(await bindingCompatible(store(),current.offlineBindingHash,local))return null;
  const saved=await native.retirement(key);if(saved&&saved.checkoutId===current.checkoutId)return saved;
  const candidate:FiscalRetirementRecord={schemaVersion:1,commandId:createUuid(),checkoutId:current.checkoutId,
   transactionId:current.transactionId,permitId:current.permit.permitId,originalOperationId:current.operationId,
   cartIdentitySha256:await cartDigest(current.cartIdentity),reason:retirementReason,scopeKey:key,phase:'CLOSING',receipt:null};
  if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
  return this.retireExpiredCheckout(candidate);
 },
 async retirementCandidate():Promise<FiscalRetirementRecord|null>{
  const auth=readAuth(),epoch=generation;auth.assertCurrent();const native=store();if(!native?.retirement)return null;
  const key=fiscalWorkflowScopeKey(scopeOf(auth.descriptor)),current=await native.currentCheckout(key);auth.assertCurrent();
  const saved=await native.retirement(key);auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
  if(saved&&(!current||saved.checkoutId===current.checkoutId))return saved;
  if(!isExpiredPrepared(current,key))return null;
  return {schemaVersion:1,commandId:createUuid(),checkoutId:current.checkoutId,transactionId:current.transactionId,permitId:current.permit!.permitId,originalOperationId:current.operationId,cartIdentitySha256:await cartDigest(current.cartIdentity),reason:retirementReason,scopeKey:key,phase:'CLOSING',receipt:null};
 },
 retireExpiredCheckout(candidate:FiscalRetirementRecord,operator?:{actorId:string;pin:string}):Promise<FiscalRetirementRecord>{
  const auth=readAuth(),epoch=generation;auth.assertCurrent();const key=fiscalWorkflowScopeKey(scopeOf(auth.descriptor));
  if(candidate.scopeKey!==key)return Promise.reject(Error('FISCAL_WORKFLOW_CONTEXT_CHANGED'));
  const existing=retirements.get(key);if(existing)return existing;
  const run=(async()=>{
   const native=store();if(!native?.beginRetirement||!native.completeRetirement)fail('FISCAL_WORKFLOW_NATIVE_REQUIRED');
   const {scopeKey:_key,phase:_phase,receipt:_receipt,...proof}=candidate;
   if(candidate.phase==='CLOSED'&&candidate.receipt){auth.assertCurrent();return native!.completeRetirement!(key,candidate.receipt);}
   const pending=await native!.beginRetirement!(key,proof);auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
   const original=await native!.readCheckout(pending.checkoutId);auth.assertCurrent();if(!original?.permit||original.permit.permitId!==pending.permitId)fail();
   const {data}=await request('retire-unborn',{...proof,nonce:original!.permit!.nonce,...(operator?{actorId:operator.actorId,pin:operator.pin}:{})},undefined,RETIREMENT_TIMEOUT_MS);
   auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');validateRetirementReceipt(data,proof,scopeOf(auth.descriptor));
   const closed=await native!.completeRetirement!(key,data);auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');return closed;
  })().finally(()=>retirements.delete(key));retirements.set(key,run);return run;
 },
 async reserveCheckout(cartIdentity:string,operationId:string,options?:{requirePermit?:boolean;dispatch?:DispatchCheckoutPreparation}):Promise<FiscalWorkflowCheckoutV2>{
  if(!this.enabled())fail('FISCAL_WORKFLOW_DISABLED');const native=store();if(!native)fail('FISCAL_WORKFLOW_NATIVE_REQUIRED');
  const auth=readAuth(),epoch=generation,scopeKey=json(scopeOf(auth.descriptor));auth.assertCurrent();
  const current=await native.currentCheckout(scopeKey);auth.assertCurrent();
  if(epoch!==generation||!this.enabled())fail('FISCAL_WORKFLOW_DISABLED');
  let expectedCurrent:FiscalWorkflowPreparedRecovery|undefined;
  if(current?.phase==='PREPARED'&&current.operationId!==operationId){
   expectedCurrent={scopeKey,checkoutId:current.checkoutId,transactionId:current.transactionId,operationId:current.operationId,
     cartIdentity,phase:'PREPARED',paymentIds:[]};
   if(!matchesPreparedRecovery(current,expectedCurrent)||options?.requirePermit!==true
     ||!hasPreparedSalePermit(current,scopeKey,authorityFor(auth)))fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
  }
  const chosenOperation=expectedCurrent?.operationId||operationId;
  const reserveOptions={requirePermit:options?.requirePermit,...(options?.requirePermit?{authorityHash:authorityFor(auth)}:{}),...(expectedCurrent?{expectedCurrent}:{})};
  const checkout=options?.dispatch?await prepareDispatch({...options.dispatch,cartIdentity,operationId:chosenOperation,fiscal:{kind:'PERMIT',scopeKey,options:reserveOptions}}):await native.reserveCheckout(scopeKey,cartIdentity,undefined,chosenOperation,reserveOptions);
  auth.assertCurrent();if(epoch!==generation||!this.enabled())fail('FISCAL_WORKFLOW_DISABLED');
  if(expectedCurrent&&(!matchesPreparedRecovery(checkout,expectedCurrent)||!hasPreparedSalePermit(checkout,scopeKey,authorityFor(auth))))fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
  return checkout;
 },
 async reserveReferencedCheckout(cartIdentity:string,operationKind:'RETURN'|'VOID',originalReference:NonNullable<FiscalWorkflowPermitV2['originalReference']>,operationId:string){
  if(!this.enabled())fail('FISCAL_WORKFLOW_DISABLED');const native=store();if(!native)fail('FISCAL_WORKFLOW_NATIVE_REQUIRED');const auth=readAuth(),scopeKey=json(scopeOf(auth.descriptor));auth.assertCurrent();
  const existing=await native.currentCheckout(scopeKey);if(existing&&!(existing.phase==='ACKNOWLEDGED'&&existing.operationId!==operationId)){if(existing.cartIdentity!==cartIdentity||existing.permit?.operationKind!==operationKind||json(existing.permit.originalReference)!==json(originalReference))fail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');if(['COMMITTED','ACKNOWLEDGED'].includes(existing.phase)){auth.assertCurrent();return existing;}}
  const operationKey=scopeKey+'|'+operationId,requestOperationId=await native.refillOperation(operationKey);
  const {data}=await request('permits',{operationId:requestOperationId,capability:'fiscalWorkflowV2',operationKind,originalReference});
  if(data?.schemaVersion===2&&data.refillRequired===true&&Array.isArray(data.permits)&&!data.permits.length&&/^[a-f0-9]{64}$/.test(data.authorityHash)){auth.assertCurrent();await native.savePermits(operationKey,requestOperationId,[]);fail('FISCAL_WORKFLOW_REFERENCED_PERMIT_REQUIRED');}
  if(data?.schemaVersion!==2||!Array.isArray(data.permits)||data.permits.length!==1||!/^[a-f0-9]{64}$/.test(data.authorityHash)||data.refillRequired)fail('FISCAL_WORKFLOW_REFERENCED_PERMIT_REQUIRED');
  const p=data.permits[0] as FiscalWorkflowPermitV2;if(!contexts(p.scope,scopeOf(auth.descriptor))||p.operationKind!==operationKind||json(p.originalReference)!==json(originalReference)||p.authorityHash!==data.authorityHash)fail();
  auth.assertCurrent();await native.savePermits(operationKey,requestOperationId,[p]);const checkout=await native.reserveCheckout(scopeKey,cartIdentity,{operationKind,originalReference},operationId,{requirePermit:true,authorityHash:p.authorityHash});auth.assertCurrent();return checkout;
 },
 async recordPayment(checkout:FiscalWorkflowCheckoutV2,paymentId:string){const native=store();if(!native)fail();let markError:unknown;try{await native.markPaymentPossible(checkout.checkoutId,paymentId);}catch(error){markError=error;}const durable=await native.readCheckout(checkout.checkoutId);if(!durable||durable.phase!=='EFFECT_POSSIBLE'||!durable.paymentIds.includes(paymentId)){if(markError)throw markError;fail('PAYMENT_INTENT_RECONCILIATION_REQUIRED');}Object.assign(checkout,durable);},
 async acknowledge(checkout:FiscalWorkflowCheckoutV2){await store()?.acknowledgeCheckout(checkout.checkoutId);},
 async cached(id:string){return await store()?.readState(id)||null;},
 async consult(id:string,signal?:AbortSignal,timeoutMs?:number):Promise<FiscalWorkflowStateV2>{
  await this.discover();
  if(!this.enabled())return Promise.reject(Error('FISCAL_WORKFLOW_DISABLED'));
  const current=inFlight.get(id);if(current)return current;
  const version=generation;
  const promise=(async()=>{
   const native=store(),source=await readSource(id);
   if(!native||!source)fail('FISCAL_WORKFLOW_RETAINED_SOURCE_REQUIRED');
   const ordinaryReturn=source.ncfType==='E34'&&!(source as any).articleFormatWire;
   const readStatus=()=>request('status?'+new URLSearchParams({transactionId:id}),undefined,signal,timeoutMs);
   // The authenticated GET and local version read are independent. Both are needed before verifying the observation.
   const [before,{data,auth}]=ordinaryReturn
    ? await Promise.all([native.readState(id),measureSettingsReturnQa('fiscal.returnPrintStatus',readStatus)])
    : [await native.readState(id),await readStatus()];
   if(version!==generation||signal?.aborted)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
   if(!contexts(data.scope,scopeOf(auth.descriptor)))fail();
   if(ordinaryReturn||data.sourceKind==='RETURN_SOURCE_V1'){
    const valid=await measureSettingsReturnQa('fiscal.returnPrintVerify',async()=>{
     const attempt=await native.readReturnAttempt?.(source.id)||null;
     return verifyReturnStatus(source,data,attempt,before);
    });
    if(!valid)fail();
   }else if(!await verifyFiscalWorkflowState(source,data))fail();
   if(before&&before.observationVersion>=data.observationVersion&&!(before.mode==='PREPARED'&&data.mode==='WORKFLOW')){
    const ordinary=before.sourceKind==='ORDINARY_SOURCE_V2'&&before.operationKind==='SALE'&&before.mode==='WORKFLOW'&&['ACCEPTED','ACCEPTED_CONDITIONAL'].includes(before.decision)&&!((source as any).articleFormatWire);
    if(ordinary){
     const core=(state:FiscalWorkflowStateV2)=>{const {originalReference: _reference,originalReferenceReason: _reason,...rest}=state;return rest;};
     if(before.observationVersion!==data.observationVersion||json(core(before))!==json(core(data))||data.originalReference!=null&&!validOrdinaryReturnReference(source,data))fail('FISCAL_WORKFLOW_OBSERVATION_CONFLICT');
     auth.assertCurrent();
     // Fresh authenticated reference metadata is transient. Native fiscal evidence remains immutable.
     return {...before,originalReference:data.originalReference??null,originalReferenceReason:data.originalReference==null?originalReferencePendingCode(data.originalReferenceReason):null};
    }
    return before;
   }
   auth.assertCurrent();
   await native.saveState(source,data,before?.observationVersion??null);
   window.dispatchEvent(new CustomEvent('fiscalWorkflowUpdated',{detail:{id,state:data}}));
   return data as FiscalWorkflowStateV2;
  })().finally(()=>inFlight.delete(id));
  inFlight.set(id,promise);
  return promise;
 },
 async correct(id:string,input:{expectedRevision:number;reason:string;buyer:Record<string,string>;actorId:string;pin:string;operationId?:string}){if(!this.enabled())fail('FISCAL_WORKFLOW_DISABLED');const source=await readSource(id),native=store();if(!source||!native)fail('FISCAL_WORKFLOW_RETAINED_SOURCE_REQUIRED');const before=await native.readState(id),{data,auth}=await request('buyer-draft',{transactionId:id,...input,operationId:input.operationId||createUuid()});if(!contexts(data.scope,scopeOf(auth.descriptor))||!await verifyFiscalWorkflowState(source,data))fail();auth.assertCurrent();await native.saveState(source,data,before?.observationVersion??null);window.dispatchEvent(new CustomEvent('fiscalWorkflowUpdated',{detail:{id,state:data}}));return data as FiscalWorkflowStateV2;},
 async runRound(){if(!this.enabled())return;const native=store();if(!native)return;const auth=readAuth(),ids=await native.candidates(json(scopeOf(auth.descriptor)),cursor,10);if(!ids.length){cursor='';return;}for(const id of ids){auth.assertCurrent();try{await this.consult(id);}catch{/* Conserves retained source and last verified evidence. */}cursor=id;}},
 };
}
export const fiscalWorkflowV2Client=createFiscalWorkflowV2Client();
export const fiscalWorkflowReason=(reason:string|null|undefined):string=>{
 if(!reason)return 'La consulta sigue pendiente. Puedes volver a consultar; se conserva el documento original.';
 if(/DISABLED/.test(reason))return 'El flujo fiscal nuevo aún no está habilitado. La venta original se conserva.';
 if(/SESSION|EXPIRED|AUTHORITY|DEVICE|CONTEXT|AUTH_REQUIRED/.test(reason))return 'La sesión o la autorización del dispositivo necesita validarse. Inicia sesión y vuelve a consultar.';
 if(/NETWORK|UNAVAILABLE|TIMEOUT|RPC_HELD/.test(reason))return 'No se pudo conectar con el ERP. Revisa la conexión y vuelve a consultar.';
 if(/AMBIGUOUS|UNIDENTIFIED|SOURCE_REQUIRED|SOURCE_CONFLICT|ORIGINAL_CHANGED|PROOF_INVALID/.test(reason))return 'No se identificó de forma segura el envío original. Se conserva pendiente para revisión.';
 if(/BUYER/.test(reason))return 'Revisa el RNC o cédula y el nombre del comprador antes del envío fiscal.';
 if(/PERMIT|BIRTH|HISTORICAL/.test(reason))return 'Esta venta no tiene autorización para un envío fiscal nuevo. Sólo se permite consultar el envío original.';
 if(/DRAFT_RACE|REVISION|CURRENT_DRAFT/.test(reason))return 'El borrador cambió. Consulta el estado actualizado antes de volver a corregir.';
 if(/PIN|OPERATOR|PERMISSION/.test(reason))return 'Verifica tu operador, PIN y permiso para corregir el comprador fiscal.';
 return 'El documento permanece pendiente de revisión. Consulta el detalle técnico si necesitas asistencia.';
};
export const fiscalWorkflowMessage=(state:FiscalWorkflowStateV2):string=>state.sourceKind==='RETURN_SOURCE_V1'?returnStatusMessage(state):state.decision==='ACCEPTED'?'e-CF aceptado por DGII.':state.decision==='ACCEPTED_CONDITIONAL'?'e-CF aceptado condicionalmente por DGII.':state.decision==='REJECTED'?'e-CF rechazado por DGII; el original se conserva.':state.state==='NEEDS_CORRECTION'?'Corrige los datos del comprador antes del envío fiscal.':state.signature?'e-CF firmado; pendiente de respuesta DGII.':fiscalWorkflowReason(state.reason);
