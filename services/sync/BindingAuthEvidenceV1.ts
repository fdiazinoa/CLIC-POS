import {sha256Utf8} from './LargeMasterSyncV3Client';
export type BindingAuthScope={origin:string;tenantId:string;companyId:string;storeId:string;terminalId:string;deviceId:string};
export type BindingAuthEvidenceV1={schemaVersion:1;source:'ERP_TERMINAL_BINDING_AUTH_V1';decision:'BOUND';origin:string;tenantId:string;companyId:string;storeId:string;terminalId:string;deviceId:string;deviceTokenFingerprint:{algorithm:'SHA256_UTF8_LITERAL';value:string};lifetime:{mode:'REVOCABLE_NO_INDEPENDENT_EXPIRY'};observedAt:string;session:{tokenFingerprint:{algorithm:'SHA256_UTF8_LITERAL';value:string};expiresAt:string}};
const deny=():never=>{throw Error('SYNC_BINDING_EVIDENCE_HELD');};
const exact=(v:any,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))deny();};
const utc=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const literal=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
/** Hashes literal UTF8, including spaces and Unicode form; never decodes, trims or coerces. */
export const bindingAuthLiteralFingerprint=async(value:unknown):Promise<string>=>{if(!literal(value))deny();return sha256Utf8(value as string);};
export async function validateBindingAuthEvidenceV1(value:unknown,scope:BindingAuthScope,deviceToken:unknown,sessionToken:unknown,expiresAt:string,now=Date.now()):Promise<BindingAuthEvidenceV1>{
 const e=value as BindingAuthEvidenceV1;
 exact(e,['schemaVersion','source','decision','origin','tenantId','companyId','storeId','terminalId','deviceId','deviceTokenFingerprint','lifetime','observedAt','session']);
 if(e.schemaVersion!==1||e.source!=='ERP_TERMINAL_BINDING_AUTH_V1'||e.decision!=='BOUND')deny();
 let origin:URL;try{origin=new URL(scope.origin);}catch{deny();}if(origin!.protocol!=='https:'||origin!.origin!==scope.origin)deny();
 for(const k of ['origin','tenantId','companyId','storeId','terminalId','deviceId'] as const)if(!literal(scope[k])||e[k]!==scope[k])deny();
 for(const k of ['tenantId','companyId','storeId','terminalId'] as const)if(!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(e[k]))deny();
 exact(e.deviceTokenFingerprint,['algorithm','value']);exact(e.lifetime,['mode']);exact(e.session,['tokenFingerprint','expiresAt']);exact(e.session.tokenFingerprint,['algorithm','value']);
 if(e.lifetime.mode!=='REVOCABLE_NO_INDEPENDENT_EXPIRY'||e.deviceTokenFingerprint.algorithm!=='SHA256_UTF8_LITERAL'||e.session.tokenFingerprint.algorithm!=='SHA256_UTF8_LITERAL'||! /^[a-f\d]{64}$/.test(e.deviceTokenFingerprint.value)||! /^[a-f\d]{64}$/.test(e.session.tokenFingerprint.value))deny();
 if(!utc(e.observedAt)||!utc(e.session.expiresAt)||e.session.expiresAt!==expiresAt||Date.parse(e.session.expiresAt)<=now||Date.parse(e.session.expiresAt)-Date.parse(e.observedAt)!==86400000)deny();
 if(await bindingAuthLiteralFingerprint(deviceToken)!==e.deviceTokenFingerprint.value||await bindingAuthLiteralFingerprint(sessionToken)!==e.session.tokenFingerprint.value)deny();
 return JSON.parse(JSON.stringify(e));
}

const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
export const validateTerminalAuthEnvelope=async(e:import('../db/TerminalAuthEvidenceStore').TerminalAuthEnvelope,now=Date.now())=>{
 exact(e,['schemaVersion','revision','scope','beforeCredentials','credentials','session','evidence']);exact(e.scope,['origin','tenantId','companyId','storeId','terminalId','deviceId']);exact(e.session,['token','expiresAt']);
 if(!literal(e.session.token))deny();let origin:URL;try{origin=new URL(e.scope.origin);}catch{deny();}if(origin!.protocol!=='https:'||origin!.origin!==e.scope.origin)deny();
 for(const k of ['tenantId','companyId','storeId','terminalId'] as const)if(!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(e.scope[k]))deny();
 if(e.schemaVersion!==1||!Number.isSafeInteger(e.revision)||e.revision<1)deny();
 let before:any,c:any;try{before=JSON.parse(e.beforeCredentials);c=JSON.parse(e.credentials);}catch{deny();}
 const omit=(r:any)=>Object.fromEntries(Object.entries(r).filter(([k])=>!['syncToken','syncTokenExpiresAt','syncTokenUpdatedAt','syncSessionObservation'].includes(k)));
 if(!same(omit(before),omit(c))||c.syncToken!==e.session.token||c.syncTokenExpiresAt!==e.session.expiresAt||c.deviceId!==e.scope.deviceId||c.companyId!==e.scope.companyId||c.storeId!==e.scope.storeId||(c.erpTenantId||c.tenantId)!==e.scope.tenantId||(c.erpTerminalId||c.terminalId)!==e.scope.terminalId)deny();
 if(!utc(e.session.expiresAt)||Date.parse(e.session.expiresAt)<=now)deny();
 for(const [keys,expected]of [[['tenantId','erpTenantId'],e.scope.tenantId],[['terminalId','erpTerminalId'],e.scope.terminalId]] as Array<[string[],string]>)for(const k of keys)if(c[k]!==undefined&&c[k]!==null&&c[k]!==expected)deny();
 if(e.evidence!==null)await validateBindingAuthEvidenceV1(e.evidence,e.scope,c.deviceToken,e.session.token,e.session.expiresAt,now);
};
