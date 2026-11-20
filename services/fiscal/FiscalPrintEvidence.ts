import type {Transaction} from '../../types';
import {verifyFiscalStatusProof,type FiscalStatusProof,sameFiscalNcf} from './FiscalStatusProof';
export interface FiscalPrintEvidence {schemaVersion:1;qrUrl:string;securityCode:string;signedAt:string}
export interface FiscalPrintDisplay extends FiscalPrintEvidence {certifiedNcf:string;dgiiAccepted:boolean;dgiiConditional?:boolean;effectiveBuyer?:Record<string,string>}
const verified=new WeakSet<object>();
export const isVerifiedFiscalPrintDisplay=(value:FiscalPrintDisplay|undefined):value is FiscalPrintDisplay=>Boolean(value&&verified.has(value));
/** DGII URL is kept byte-for-byte. Never synthesize a stamp or a security value. */
export const fiscalCivilDate=(value:string):string=>{
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('-');
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santo_Domingo',day:'2-digit',month:'2-digit',year:'numeric'}).format(date).replace(/\//g,'-');
};
export const validateDgiiPrintContext=(context:{issuerRnc:string;environment:number;ncf:string;evidence?:FiscalPrintEvidence},tx:Transaction,consumerFinalE32Return=false):FiscalPrintDisplay|undefined=>{
 const evidence=context.evidence;
 if(!evidence||evidence.schemaVersion!==1||typeof evidence.qrUrl!=='string'||evidence.qrUrl.length>4096
   ||typeof evidence.securityCode!=='string'||!/^[A-Za-z0-9+/=]{6}$/.test(evidence.securityCode)
   ||typeof evidence.signedAt!=='string'||!/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(evidence.signedAt))return;
 const ncf=context.ncf;
 if(!/^E(?:31|32|34|44|45)\d{10}$/.test(ncf)||!sameFiscalNcf(ncf,tx.electronicNcf||tx.ncf))return;
 let url:URL;try{url=new URL(evidence.qrUrl);}catch{return;}
 const environmentPath=({0:'testecf',1:'certecf',2:'ecf'} as Record<number,string>)[context.environment];
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!environmentPath)return;
 const consumer=tx.ncfType==='E32'&&Math.abs(tx.total)<250000;
 if(url.hostname!==(consumer?'fc.dgii.gov.do':'ecf.dgii.gov.do')
   ||url.pathname.toLowerCase()!==`/${environmentPath}/${consumer?'consultatimbrefc':'consultatimbre'}`)return;
 const params=new Map<string,string>();
 for(const [key,value] of url.searchParams){const normalized=key.toLowerCase();if(params.has(normalized))return;params.set(normalized,value);}
 const buyer=String(tx.customerSnapshot?.taxId||'').replace(/\D/g,'');
 const anonymousReturn=consumerFinalE32Return&&tx.ncfType==='E34'&&ncf.startsWith('E34')
   &&/^E32\d{10}$/.test(tx.affectedNCF||'')&&!tx.customerSnapshot?.taxId;
 const allowed=consumer?['rncemisor','encf','montototal','codigoseguridad']
   :['rncemisor','encf','fechaemision','montototal','fechafirma','codigoseguridad',...(anonymousReturn?[]:['rnccomprador'])];
 if([...params.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>!params.has(key)))return;
 const amount=params.get('montototal')!;
 if(params.get('rncemisor')!==context.issuerRnc||params.get('encf')!==ncf||params.get('codigoseguridad')!==evidence.securityCode
   ||!/^\d+(?:\.\d{1,2})?$/.test(amount)||Math.abs(Number(amount)-Math.abs(tx.total))>=0.005)return;
 if(!consumer){
   const date=fiscalCivilDate(tx.date);
   if((!anonymousReturn&&(!buyer||params.get('rnccomprador')!==buyer))||params.get('fechaemision')!==date||params.get('fechafirma')!==evidence.signedAt)return;
 }
 return {...evidence,certifiedNcf:ncf,dgiiAccepted:false};
};
export const validateDgiiPrintEvidence=(proof:FiscalStatusProof,tx:Transaction):FiscalPrintDisplay|undefined=>validateDgiiPrintContext({issuerRnc:proof.issuer.rnc,environment:proof.issuer.environment,ncf:proof.providerReceipt.returnedNcf,evidence:proof.providerReceipt.printEvidence},tx);
/** This proof authorizes printing signed evidence, independently of DGII acceptance. */
export const resolveFiscalPrintDisplay=async(tx:Transaction):Promise<FiscalPrintDisplay|undefined>=>{
 const workflow=await resolveWorkflowPrintDisplay(tx);if(workflow)return workflow;
 const proof=tx.fiscalPrintProof || tx.fiscalStatusProof;
 const scope=tx.fiscalPrintScope||tx.fiscalSubmissionScope||tx.fiscalLookupApproval;
 if(!proof||!scope||!['ACCEPTED','PENDING'].includes(proof.decision)||!await verifyFiscalStatusProof(proof,scope,tx,false))return;
 const display=validateDgiiPrintEvidence(proof,tx);
 if(display){display.dgiiAccepted=await verifyFiscalStatusProof(proof,scope,tx) || Boolean(tx.fiscalStatusProof&&await verifyFiscalStatusProof(tx.fiscalStatusProof,scope,tx));verified.add(Object.freeze(display));}
 return display;
};

/** Acceptance verification is independent of RI availability. A plain SYNCED flag is never sufficient. */
export interface VerifiedFiscalAcceptance {schemaVersion:1;dgiiAccepted:true;dgiiConditional?:boolean}
const accepted=new WeakSet<object>();
export const isVerifiedFiscalAcceptance=(value:VerifiedFiscalAcceptance|undefined):value is VerifiedFiscalAcceptance=>Boolean(value&&accepted.has(value));
export const resolveFiscalAcceptance=async(tx:Transaction):Promise<VerifiedFiscalAcceptance|undefined>=>{
 const verifiedState=await readVerifiedWorkflowState(tx);
 const state=verifiedState?.state;
 if(state&&['ACCEPTED','ACCEPTED_CONDITIONAL'].includes(state.decision)){const result:VerifiedFiscalAcceptance={schemaVersion:1,dgiiAccepted:true,dgiiConditional:state.decision==='ACCEPTED_CONDITIONAL'};accepted.add(Object.freeze(result));return result;}
 const scope=tx.fiscalSubmissionScope||tx.fiscalLookupApproval||tx.fiscalPrintScope;
 if(!scope||!tx.fiscalStatusProof||!await verifyFiscalStatusProof(tx.fiscalStatusProof,scope,tx))return;
 const evidence:VerifiedFiscalAcceptance={schemaVersion:1,dgiiAccepted:true};accepted.add(Object.freeze(evidence));return evidence;
};

/** A sidecar never replaces the retained commercial/fiscal source. */
async function readVerifiedWorkflowState(tx:Transaction){
 if(tx.fiscalProvider!=='MSELLER')return null;
 const {fiscalWorkflowV2Client,verifyFiscalWorkflowState}=await import('./FiscalWorkflowV2Client');
 const state=await fiscalWorkflowV2Client.cached(tx.id);
 if(!state)return null;
 if(state.sourceKind==='RETURN_SOURCE_V1'){
  const {dbAdapter}=await import('../db');
  const {isConsumerFinalE32Return}=await import('./FiscalReturnV1');
  const attempt=await dbAdapter.fiscalReturnStore?.byTransaction(tx.id)||null;
  if(!await verifyFiscalWorkflowState(tx,state,attempt))return null;
  return {state,consumerFinalE32:Boolean(attempt?.preparation&&isConsumerFinalE32Return(attempt.preparation))};
 }
 return await verifyFiscalWorkflowState(tx,state)?{state,consumerFinalE32:false}:null;
}
async function resolveWorkflowPrintDisplay(tx:Transaction):Promise<FiscalPrintDisplay|undefined>{
 const verifiedState=await readVerifiedWorkflowState(tx);
 const state=verifiedState?.state;if(!state?.signature||state.decision==='REJECTED')return;
 const effective=state.buyer?{...tx,customerSnapshot:{...state.buyer,name:state.buyer.name||''}} as Transaction:tx;
 const display=validateDgiiPrintContext({issuerRnc:state.issuerRnc,environment:state.environment,ncf:state.ncf,evidence:state.signature},effective,verifiedState.consumerFinalE32);
 if(!display)return;
 display.dgiiAccepted=['ACCEPTED','ACCEPTED_CONDITIONAL'].includes(state.decision);
 display.dgiiConditional=state.decision==='ACCEPTED_CONDITIONAL';if(state.buyer)display.effectiveBuyer=Object.freeze({...state.buyer});
 verified.add(Object.freeze(display));return display;
}
export const fiscalPrintTransaction=(tx:Transaction,display:FiscalPrintDisplay|undefined):Transaction=>
 isVerifiedFiscalPrintDisplay(display)&&display.effectiveBuyer?{...tx,customerSnapshot:{...display.effectiveBuyer,name:display.effectiveBuyer.name||''},customerName:display.effectiveBuyer.name||tx.customerName} as Transaction:tx;
/** Explicit print/email readiness only. Financial completion never waits here; no provider or ISSUE endpoint exists in this client. */
export async function resolveFiscalPrintReadiness(tx:Transaction,{timeoutMs=8000,signal}:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<FiscalPrintDisplay|undefined>{
 let display=await resolveFiscalPrintDisplay(tx);if(display||tx.fiscalProvider!=='MSELLER'||signal?.aborted)return display;
 const {fiscalWorkflowV2Client}=await import('./FiscalWorkflowV2Client');
 if(!fiscalWorkflowV2Client.enabled())return display;
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 const budget=Math.max(0,Math.min(8000,timeoutMs)),deadline=Date.now()+budget;
 let finishDeadline:()=>void=()=>{};const stopped=new Promise<undefined>(resolve=>{finishDeadline=()=>resolve(undefined);});
 const timer=setTimeout(()=>{abort();finishDeadline();},budget);
 controller.signal.addEventListener('abort',finishDeadline,{once:true});
 try{
  do{try{const state=await Promise.race([fiscalWorkflowV2Client.consult(tx.id,controller.signal),stopped]);if(!state)return display;display=await resolveFiscalPrintDisplay(tx);if(display||state.decision==='REJECTED'||state.state==='HELD'||state.state==='NEEDS_CORRECTION')return display;}catch{ return display; }
   const left=deadline-Date.now();if(left<=0||controller.signal.aborted)break;
   await new Promise<void>(resolve=>{const done=()=>{clearTimeout(wait);controller.signal.removeEventListener('abort',done);resolve();};const wait=setTimeout(done,Math.min(1500,left));controller.signal.addEventListener('abort',done,{once:true});});
  }while(!controller.signal.aborted&&Date.now()<deadline);
  return display;
 }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',finishDeadline);controller.abort();signal?.removeEventListener('abort',abort);}
}
