import {serializeBindingAuthExchange,captureBindingAuthAttempt,persistBindingAuthResponse,recoverBindingAuthEvidence,type BindingAuthPersistencePorts} from './BindingAuthEvidencePersistence';
import {CAJA6_FISCAL_SCOPE as allowed} from '../fiscal/Caja6FiscalPreparationPolicy';
import {sha256Utf8} from './LargeMasterSyncV3Client';
import {validatedLargeMasterSyncV3ErpSyncBase,readLargeMasterSyncV3BoundIdentity,type LargeMasterSyncV3BoundIdentity} from './LargeMasterSyncV3BoundTransport';
import {captureTerminalSessionSnapshot,saveTerminalSessionCAS,type TerminalSessionSnapshot,type TerminalSessionObservation} from './TerminalCredentialStore';
const held=():never=>{throw Error('SYNC_AUTH_SESSION_HELD');};
const literal=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.trim()===v&&!/[\r\n\t]/.test(v);
const aliases=(r:any,keys:string[],expected:string)=>{for(const k of keys)if(Object.prototype.hasOwnProperty.call(r,k)&&r[k]!==expected)held();};
/** Existing c348 AUTH response, not a new ERP binding-proof DTO. */
export function validateBoundSessionAuthResponse(r:any,scope:{tenantId:string;terminalId:string;deviceId:string;companyId?:string;storeId?:string},deviceToken:string,now=Date.now()){
 if(!r||r.status!=='AUTHORIZED'||r.success!==true||!literal(r.syncToken)||r.token!==r.syncToken||!literal(r.tokenExpiresAt)||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.tokenExpiresAt)||!Number.isFinite(Date.parse(r.tokenExpiresAt))||Date.parse(r.tokenExpiresAt)<=now)held();
 for(const [keys,value]of [[['tenantId','tenant_id'],scope.tenantId],[['terminalId','terminal_id','erpTerminalId','erp_terminal_id'],scope.terminalId],[['deviceId','device_id'],scope.deviceId]] as Array<[string[],string]>){if(!keys.some(k=>Object.prototype.hasOwnProperty.call(r,k)))held();aliases(r,keys,value);}
 for(const [keys,expected]of [[['companyId','company_id'],scope.companyId],[['storeId','store_id'],scope.storeId]] as Array<[string[],string|undefined]>)for(const key of keys)if(Object.prototype.hasOwnProperty.call(r,key)&&(!expected||r[key]!==expected))held();
 aliases(r,['syncToken','sync_token','token'],r.syncToken);aliases(r,['tokenExpiresAt','token_expires_at','syncTokenExpiresAt','sync_token_expires_at'],r.tokenExpiresAt);
 aliases(r,['deviceToken','device_token','terminalToken','terminal_token','activationToken','activation_token'],deviceToken);
 return {token:r.syncToken as string,expiresAt:r.tokenExpiresAt as string};
}
type Dependencies={persistence?:BindingAuthPersistencePorts;identity?:()=>LargeMasterSyncV3BoundIdentity;capture?:()=>TerminalSessionSnapshot;save?:typeof saveTerminalSessionCAS;fetchImpl?:typeof fetch;hashDevice?:(v:string)=>Promise<string>;configFingerprint:()=>string;timeoutMs?:number};
/** Explicit Caja6-only AUTH. No register, retry, fallback, binding proof or fiscal activation. */
async function renewBoundSession(deps:Dependencies):Promise<{status:'SESSION_RENEWED_BINDING_PROOF_REQUIRED'}>{
 const identity=deps.identity||readLargeMasterSyncV3BoundIdentity,capture=deps.capture||captureTerminalSessionSnapshot,save=deps.save||saveTerminalSessionCAS,fetchImpl=deps.fetchImpl||fetch;
 await recoverBindingAuthEvidence(deps.persistence);
 const bound=identity(),snapshot=capture(),c=snapshot.credentials,base=validatedLargeMasterSyncV3ErpSyncBase(bound.erpSyncBaseUrl),origin=new URL(base).origin,config=deps.configFingerprint();
 if(origin!==allowed.origin||bound.tenantId!==allowed.tenantId||bound.terminalId!==allowed.terminalId||c.companyId!==allowed.companyId||c.storeId!==allowed.storeId||c.deviceId!==bound.deviceId||c.syncToken!==bound.syncToken||!literal(c.deviceToken)||!literal(bound.syncToken)||c.deviceTokenSource!=='ERP_REGISTER'||c.identityMigrationRequired||/DEVICE_NOT_AUTHORIZED|NEEDS_REAUTH|BOUND_AUTH_MISMATCH|AUTH_ERROR|REVOKED/i.test(c.authStatus||''))held();
 aliases(c,['tenantId','erpTenantId'],bound.tenantId);aliases(c,['terminalId','erpTerminalId'],bound.terminalId);
 if(!(c.tenantId||c.erpTenantId)||!(c.terminalId||c.erpTerminalId)||await(deps.hashDevice||sha256Utf8)(bound.deviceId)!==allowed.deviceSha256)held();
 const fingerprint=JSON.stringify(bound);
 const current=()=>{if(JSON.stringify(identity())!==fingerprint||capture().document!==snapshot.document||deps.configFingerprint()!==config)held();};current();
 const attempt=await captureBindingAuthAttempt({origin,tenantId:bound.tenantId,companyId:c.companyId!,storeId:c.storeId!,terminalId:bound.terminalId,deviceId:bound.deviceId},current,deps.persistence);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),deps.timeoutMs??5000);
 try{
  const response=await fetchImpl(base+'/auth',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${bound.syncToken}`,'X-Sync-Token':bound.syncToken,'X-Tenant-Id':bound.tenantId,'X-Terminal-Id':bound.terminalId,'X-Device-Id':bound.deviceId,'X-Device-Token':c.deviceToken!},body:JSON.stringify({terminalId:bound.terminalId,deviceId:bound.deviceId}),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
  current();if(response.status!==200||response.redirected||!response.headers.get('content-type')?.toLowerCase().includes('application/json'))held();
  const text=await response.text();if(new TextEncoder().encode(text).length>65536)held();current();
  const data=JSON.parse(text),session=validateBoundSessionAuthResponse(data,{...bound,companyId:c.companyId!,storeId:c.storeId!},c.deviceToken!);
  const observation:TerminalSessionObservation={source:'LOCAL_OBSERVATION_OF_ERP_SYNC_AUTH',origin,route:'/api/sync/auth',tenantId:bound.tenantId,terminalId:bound.terminalId,deviceId:bound.deviceId,observedAt:new Date().toISOString()};
  if(!await persistBindingAuthResponse(attempt,data,session,observation,deps.persistence))await save(snapshot,{...session,observation},current);return {status:'SESSION_RENEWED_BINDING_PROOF_REQUIRED'};
 }catch{held();}finally{clearTimeout(timer);}
}

/** Shares the normal AUTH queue so neither channel can publish out of order. */
export function renewCaja6BoundSession(deps:Dependencies):Promise<{status:'SESSION_RENEWED_BINDING_PROOF_REQUIRED'}>{
 return serializeBindingAuthExchange(()=>renewBoundSession(deps));
}
