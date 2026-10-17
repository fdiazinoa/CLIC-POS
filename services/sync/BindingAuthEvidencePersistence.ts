import {readLargeMasterSyncV3BoundIdentity,validatedLargeMasterSyncV3ErpSyncBase} from './LargeMasterSyncV3BoundTransport';
import type {TerminalAuthEvidenceStore,TerminalAuthEnvelope,TerminalAuthRecord} from '../db/TerminalAuthEvidenceStore';
import {validateBindingAuthEvidenceV1,validateTerminalAuthEnvelope,type BindingAuthScope} from './BindingAuthEvidenceV1';
import {captureTerminalSessionSnapshot,projectTerminalAuthEnvelope,verifyTerminalAuthProjection,type TerminalSessionSnapshot,type TerminalSessionObservation} from './TerminalCredentialStore';
const held=():never=>{throw Error('SYNC_BINDING_EVIDENCE_HELD');};
export type BindingAuthAttempt={snapshot:TerminalSessionSnapshot;record:TerminalAuthRecord|null;scope:BindingAuthScope;assertCurrent:()=>void;store:TerminalAuthEvidenceStore|null};
export type BindingAuthReadContext={scope:BindingAuthScope;sessionToken:string;configFingerprint:string};
export type BindingAuthPersistencePorts={readContext:()=>BindingAuthReadContext;store:()=>Promise<TerminalAuthEvidenceStore|null>;capture:typeof captureTerminalSessionSnapshot;project:typeof projectTerminalAuthEnvelope;verifyProjection:typeof verifyTerminalAuthProjection};
const nativeStore=async():Promise<TerminalAuthEvidenceStore|null>=>{const {Capacitor}=await import('@capacitor/core');if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android')return null;const {dbAdapter}=await import('../db');await dbAdapter.connect();return dbAdapter.terminalAuthEvidenceStore||null;};
const readBoundContext=():BindingAuthReadContext=>{const identity=readLargeMasterSyncV3BoundIdentity(),c=captureTerminalSessionSnapshot().credentials;return {scope:{origin:new URL(validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl)).origin,tenantId:identity.tenantId,terminalId:identity.terminalId,deviceId:identity.deviceId,companyId:c.companyId!,storeId:c.storeId!},sessionToken:identity.syncToken,configFingerprint:JSON.stringify([localStorage.getItem('initial_terminal_config'),localStorage.getItem('clic_sync_profile')])};};
export const bindingAuthPersistencePorts:BindingAuthPersistencePorts={readContext:readBoundContext,store:nativeStore,capture:captureTerminalSessionSnapshot,project:projectTerminalAuthEnvelope,verifyProjection:verifyTerminalAuthProjection};
/** No remote requests. Rehydrates only exact known before/after projections; unrelated edits remain HOLD. */
export async function recoverBindingAuthEvidence(ports:BindingAuthPersistencePorts=bindingAuthPersistencePorts):Promise<TerminalAuthRecord|null>{
 const store=await ports.store();if(!store)return null;const record=await store.read();if(!record)return null;
 await validateTerminalAuthEnvelope(record.envelope,0);const current=ports.capture().document,e=record.envelope;
 if(current!==e.beforeCredentials&&current!==e.credentials)held();
 await ports.project(e.beforeCredentials,e.credentials,async()=>{if((await store.read())?.raw!==record.raw)held();});return record;
}
export async function captureBindingAuthAttempt(scope:BindingAuthScope,assertCurrent:()=>void,ports:BindingAuthPersistencePorts=bindingAuthPersistencePorts):Promise<BindingAuthAttempt>{
 await recoverBindingAuthEvidence(ports);const store=await ports.store(),snapshot=ports.capture(),record=store?await store.read():null;assertCurrent();return {scope,snapshot,record,assertCurrent,store};
}
/** Called before any legacy AUTH persistence. False means no evidence and no existing native association. */
export async function persistBindingAuthResponse(attempt:BindingAuthAttempt|null,data:any,session:{token:string;expiresAt:string},observation:TerminalSessionObservation,ports:BindingAuthPersistencePorts=bindingAuthPersistencePorts):Promise<boolean>{
 const present=Object.prototype.hasOwnProperty.call(data||{},'bindingEvidence');
 if(!attempt){if(present)held();return false;}
 if(!present&&!attempt.record)return false;
 if(!attempt.store)held();
 const {snapshot,scope,record}=attempt;attempt.assertCurrent();if(ports.capture().document!==snapshot.document)held();
 const c=snapshot.credentials,evidence=present?await validateBindingAuthEvidenceV1(data.bindingEvidence,scope,c.deviceToken,session.token,session.expiresAt):null;
 const credentials=JSON.stringify({...JSON.parse(snapshot.document),syncToken:session.token,syncTokenExpiresAt:session.expiresAt,syncTokenUpdatedAt:observation.observedAt,syncSessionObservation:observation});
 const next:TerminalAuthEnvelope={schemaVersion:1,revision:(record?.envelope.revision??0)+1,scope,beforeCredentials:snapshot.document,credentials,session,evidence};
 await validateTerminalAuthEnvelope(next);attempt.assertCurrent();
 try{await attempt.store!.commit(record?.raw??null,next);}catch{await attempt.store!.read().catch(()=>null);held();}
 // A crash/failed projection never rolls back the SQL association or creates a second AUTH.
 try{await ports.project(snapshot.document,credentials,async()=>{attempt.assertCurrent();if((await attempt.store!.read())?.raw!==JSON.stringify(next))held();});}catch{held();}return true;
}
/** Returns only a whole verified association, never a proof attached to unrelated legacy credentials. */
export async function readCurrentBindingAuthEvidence(ports:BindingAuthPersistencePorts=bindingAuthPersistencePorts):Promise<TerminalAuthEnvelope|null>{
 const store=await ports.store();if(!store)return null;const record=await store.read();if(!record)return null;const context=ports.readContext(),contextPin=JSON.stringify(context);await validateTerminalAuthEnvelope(record.envelope);
 const e=record.envelope;
 if((['origin','tenantId','companyId','storeId','terminalId','deviceId'] as const).some(k=>context.scope[k]!==e.scope[k])||context.sessionToken!==e.session.token||ports.capture().document!==e.credentials)held();
 await ports.verifyProjection(e.credentials);
 if((await store.read())?.raw!==record.raw||ports.capture().document!==e.credentials||JSON.stringify(ports.readContext())!==contextPin)held();
 await ports.verifyProjection(e.credentials);
 if((await store.read())?.raw!==record.raw||ports.capture().document!==e.credentials||JSON.stringify(ports.readContext())!==contextPin)held();
 return JSON.parse(JSON.stringify(e));
}

/** Captures the existing normal AUTH caller's context before its request, without inventing missing authority. */
export async function captureNormalBindingAuthAttempt(input:{base:string;terminalId:string;deviceId:string|null;tenantId:string|null;configFingerprint:()=>string},ports:BindingAuthPersistencePorts=bindingAuthPersistencePorts):Promise<BindingAuthAttempt|null>{
 await recoverBindingAuthEvidence(ports);let snapshot:TerminalSessionSnapshot;try{snapshot=ports.capture();}catch{return null;}
 const c=snapshot.credentials;let origin:string;try{const url=new URL(input.base);if(url.protocol!=='https:'||url.pathname.replace(/\/$/,'')!=='/api/sync'||url.search||url.hash||url.username||url.password)return null;origin=url.origin;}catch{return null;}
 if(!input.deviceId||!input.tenantId||!c.companyId||!c.storeId||c.deviceId!==input.deviceId||(c.erpTenantId||c.tenantId)!==input.tenantId||(c.erpTerminalId||c.terminalId)!==input.terminalId||typeof c.deviceToken!=='string'||!c.deviceToken)return null;
 const scope={origin,tenantId:input.tenantId,companyId:c.companyId,storeId:c.storeId,terminalId:input.terminalId,deviceId:input.deviceId},config=input.configFingerprint();
 const assertCurrent=()=>{if(input.configFingerprint()!==config||ports.capture().document!==snapshot.document)held();};
 return captureBindingAuthAttempt(scope,assertCurrent,ports);
}

/** One request and bounded body for the existing Caja6 normal AUTH path; never register/retry/fallback. */
export async function fetchBindingAuthOnce(url:string,init:RequestInit,fetchImpl:typeof fetch=fetch):Promise<Response>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{const response=await fetchImpl(url,{...init,signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});if(response.status!==200||response.redirected||!response.headers.get('content-type')?.toLowerCase().includes('application/json'))held();
  const reader=response.body?.getReader();if(!reader)held();let text='',size=0;const decoder=new TextDecoder();try{while(true){const part=await reader!.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader!.cancel();held();}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader!.releaseLock();}
  return new Response(text,{status:200,headers:{'content-type':'application/json'}});
 }catch{held();}finally{clearTimeout(timer);}
}

let bindingAuthExchangeQueue:Promise<unknown>=Promise.resolve();
/** Shared by normal AUTH and the explicit Caja6 entry, through persistence/publication. */
export const serializeBindingAuthExchange=<T>(work:()=>Promise<T>):Promise<T>=>{
 const operation=bindingAuthExchangeQueue.then(work);bindingAuthExchangeQueue=operation.catch(()=>undefined);return operation;
};
