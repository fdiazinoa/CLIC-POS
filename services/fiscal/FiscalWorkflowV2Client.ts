import {matchesPreparedRecovery,hasPreparedSalePermit} from './FiscalWorkflowCheckoutRecovery';
import {hasFiscalWorkflowCapability,observeFiscalWorkflowCapability} from './FiscalWorkflowV2Capability';
import type {Transaction} from '../../types';
import {dbAdapter} from '../db';
import {createUuid} from '../../utils/uuid';
import {financialIdentity} from '../db/LargeMasterSyncV3FinancialRetention';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {fiscalStatusSourceChecksum} from './FiscalStatusProof';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import type {FiscalWorkflowCheckoutV2,FiscalWorkflowPermitV2,FiscalWorkflowScope,FiscalWorkflowStateV2,FiscalWorkflowPreparedRecovery} from './FiscalWorkflowV2Types';
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])):value;
const json=(value:any)=>JSON.stringify(canonical(value));
const fail=(code='FISCAL_WORKFLOW_PROOF_INVALID'):never=>{throw Error(code);};
const scopeOf=(descriptor:FiscalWorkflowScope):FiscalWorkflowScope=>({tenantId:descriptor.tenantId,companyId:descriptor.companyId,storeId:descriptor.storeId,terminalId:descriptor.terminalId,deviceId:descriptor.deviceId});
const contexts=(scope:FiscalWorkflowScope,other:FiscalWorkflowScope)=>json(scope)===json(other);
export async function verifyFiscalWorkflowState(source:Transaction,state:FiscalWorkflowStateV2):Promise<boolean>{
 if(!state||state.schemaVersion!==2||state.source!=='ERP_POS_FISCAL_WORKFLOW_V2'||!['WORKFLOW','STATUS_ONLY'].includes(state.mode)||source.id!==state.transactionId||source.terminalId!==state.scope?.terminalId||source.ncf!==state.ncf||source.ncfType!==state.ncfType||source.total!==state.total||state.currency!=='DOP'||state.exchangeRate!==1||!Number.isSafeInteger(state.observationVersion)||state.observationVersion<0||!Number.isSafeInteger(state.draftRevision)||state.draftRevision<0||!['PENDING','ACCEPTED','ACCEPTED_CONDITIONAL','REJECTED'].includes(state.decision)||!Number.isFinite(Date.parse(state.observedAt)))return false;
 const envelope=state.originalSourceEnvelope;
 if(state.sourceKind==='FORMAT_SOURCE_V2')return verifyFormatWorkflowSource(source,state);
 if(envelope?.event)return false;
 const original=envelope?.transaction as Transaction;
 if(!original||financialIdentity(original)!==financialIdentity(source)||await fiscalStatusSourceChecksum(source)!==state.checksumV1)return false;
 const f=original.fiscalIssuance;
 if(!f||f.issuerRnc!==state.issuerRnc||f.tenantId!==state.scope.tenantId||f.companyId!==state.scope.companyId||f.terminalId!==state.scope.terminalId||original.fiscalEnvironment!==state.environment||((original as any).currency||original.settlementCurrencyCode)!==state.currency)return false;
 const digest=await sha256Utf8(json({schemaVersion:2,source:'POS_ORIGINAL_ENVELOPE_V2',scope:state.scope,saleEventId:state.saleEventId,payload:envelope}));
 if(digest!==state.originalDigestV2)return false;
 if(state.mode==='STATUS_ONLY'&&(state.workflowId!==null||state.permitId!==null||state.canCorrect||state.draftRevision!==0))return false;
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
export function createFiscalWorkflowV2Client({readAuth=captureFiscalStatusBoundContext,fetchImpl=fetch,store=()=>dbAdapter.fiscalWorkflowStore,readSource=async(id:string)=>await dbAdapter.getDocument<Transaction>('transactions',id)||await dbAdapter.getDocument<Transaction>('transactionHistory',id)}={}){
 const refills=new Map<string,Promise<void>>();const inFlight=new Map<string,Promise<FiscalWorkflowStateV2>>();let cursor='',generation=0;let currentAuthority:{fingerprint:string;authorityHash:string;expires:number}|null=null;
 let discovering:{key:string;promise:Promise<void>}|null=null;
 const authorityFingerprint=(auth:ReturnType<typeof readAuth>)=>json([auth.base,auth.headers,(auth as any).fingerprint||null]);
 const authorityFor=(auth:ReturnType<typeof readAuth>)=>currentAuthority?.fingerprint===authorityFingerprint(auth)&&currentAuthority.expires>Date.now()?currentAuthority.authorityHash:undefined;
 const request=async(path:string,body?:Record<string,any>,signal?:AbortSignal)=>{
  const auth=readAuth();auth.assertCurrent();const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,8000);
  try{const response=await fetchImpl(`${auth.base}/fiscal/workflow/v2/${path}`,{method:body?'POST':'GET',headers:{...auth.headers,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});const data=await response.json();auth.assertCurrent();if(!response.ok)fail(typeof data?.code==='string'?data.code:'FISCAL_WORKFLOW_UNAVAILABLE');if(JSON.stringify(data).length>600000)fail();return {data,auth};}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
 return {
 enabled(){try{const auth=readAuth();auth.assertCurrent();return hasFiscalWorkflowCapability(auth.base,auth.headers);}catch{return false;}},
 invalidate(){generation++;cursor='';currentAuthority=null;},
 discover():Promise<void>{
  let auth:ReturnType<typeof readAuth>;try{auth=readAuth();auth.assertCurrent();}catch(error){return Promise.reject(error);}
  if(hasFiscalWorkflowCapability(auth.base,auth.headers))return Promise.resolve();
  const key=authorityFingerprint(auth),epoch=generation;if(discovering?.key===key)return discovering.promise;
  const promise=(async()=>{
   const {data}=await request('capability');auth.assertCurrent();if(epoch!==generation)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');
   const keys=['schemaVersion','capability','version','scope','authorityHash','sessionExpiresAt'];
   const expires=Date.parse(data?.sessionExpiresAt),localExpires=Date.parse((auth as any).sessionExpiresAt||data?.sessionExpiresAt),now=Date.now();
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(data,k))
    ||data.schemaVersion!==2||data.capability!=='fiscalWorkflowV2'||data.version!==2||!contexts(data.scope,scopeOf(auth.descriptor))
    ||typeof data.sessionExpiresAt!=='string'||!/^[a-f0-9]{64}$/.test(data.authorityHash)||!Number.isFinite(expires)||!Number.isFinite(localExpires)||Math.min(expires,localExpires)<=now)fail();
   // Discovery grants availability only. The normal permit response must still prove its own authority.
   observeFiscalWorkflowCapability(auth.base,auth.headers,'2',now,Math.min(300000,expires-now,localExpires-now));
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
 async reserveCheckout(cartIdentity:string,operationId:string,options?:{requirePermit?:boolean}):Promise<FiscalWorkflowCheckoutV2>{
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
  const checkout=await native.reserveCheckout(scopeKey,cartIdentity,undefined,chosenOperation,
    {...options,...(options?.requirePermit?{authorityHash:authorityFor(auth)}:{}),...(expectedCurrent?{expectedCurrent}:{})});
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
 async recordPayment(checkout:FiscalWorkflowCheckoutV2,paymentId:string){await store()?.markPaymentPossible(checkout.checkoutId,paymentId);},
 async acknowledge(checkout:FiscalWorkflowCheckoutV2){await store()?.acknowledgeCheckout(checkout.checkoutId);},
 async cached(id:string){return await store()?.readState(id)||null;},
 consult(id:string,signal?:AbortSignal):Promise<FiscalWorkflowStateV2>{if(!this.enabled())return Promise.reject(Error('FISCAL_WORKFLOW_DISABLED'));const current=inFlight.get(id);if(current)return current;const version=generation;const promise=(async()=>{const native=store(),source=await readSource(id);if(!native||!source)fail('FISCAL_WORKFLOW_RETAINED_SOURCE_REQUIRED');const before=await native.readState(id),{data,auth}=await request('status?'+new URLSearchParams({transactionId:id}),undefined,signal);if(version!==generation||signal?.aborted)fail('FISCAL_WORKFLOW_CONTEXT_CHANGED');if(!contexts(data.scope,scopeOf(auth.descriptor))||!await verifyFiscalWorkflowState(source,data))fail();if(before&&before.observationVersion>=data.observationVersion)return before;auth.assertCurrent();await native.saveState(source,data,before?.observationVersion??null);window.dispatchEvent(new CustomEvent('fiscalWorkflowUpdated',{detail:{id,state:data}}));return data as FiscalWorkflowStateV2;})().finally(()=>inFlight.delete(id));inFlight.set(id,promise);return promise;},
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
export const fiscalWorkflowMessage=(state:FiscalWorkflowStateV2):string=>state.decision==='ACCEPTED'?'e-CF aceptado por DGII.':state.decision==='ACCEPTED_CONDITIONAL'?'e-CF aceptado condicionalmente por DGII.':state.decision==='REJECTED'?'e-CF rechazado por DGII; el original se conserva.':state.state==='NEEDS_CORRECTION'?'Corrige los datos del comprador antes del envío fiscal.':state.signature?'e-CF firmado; pendiente de respuesta DGII.':fiscalWorkflowReason(state.reason);
