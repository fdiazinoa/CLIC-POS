import {canonicalPresentationJson,inventoryPresentationRevision,validateInventoryPresentationMaster,type InventoryPresentationMaster} from './contract';
import type {InventoryPresentationStore} from './store';
import {readLargeMasterSyncV3BoundIdentity,validatedLargeMasterSyncV3ErpSyncBase,type LargeMasterSyncV3BoundIdentity} from '../sync/LargeMasterSyncV3BoundTransport';
import {readTerminalCredentialsSync,type TerminalCredentials} from '../sync/TerminalCredentialStore';
export const PRESENTATIONS_ROOT='/api/sync/inventory-presentations/v1';
export interface PresentationScope {tenantId:string;companyId:string;storeId:string;terminalId:string;deviceId:string;warehouseId:string;localId:string}
export interface PresentationContext {schemaVersion:1;contract:'INVENTORY_PRESENTATIONS_V1';scope:PresentationScope;tariffIds:string[];categories:string[];inventoryQuantityUnit:'BASE';contextRevision:string;returnPolicy:'SOURCE_REQUIRED_NOT_YET_SUPPORTED';mastersUrl:'/api/sync/inventory-presentations/v1/masters'}
export interface PresentationPage {schemaVersion:1;contract:'INVENTORY_PRESENTATIONS_V1';contextRevision:string;items:InventoryPresentationMaster[];checksum:string;nextAfter:string|null}
export interface PresentationAuthority {origin:string;scope:PresentationScope;tariffIds:string[];categories:string[]}
export interface PresentationAuth {origin:string;scope:Pick<PresentationScope,'tenantId'|'companyId'|'storeId'|'terminalId'|'deviceId'>;headers:Record<string,string>;assertCurrent():void}
const scopeKeys=['tenantId','companyId','storeId','terminalId','deviceId','warehouseId','localId'] as const;
const need=(ok:unknown,code='INVENTORY_PRESENTATION_PROTOCOL_INVALID'):void=>{if(!ok)throw Error(code);};
const exact=(v:any,keys:string[])=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k)));
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length>0)&&new Set(v).size===v.length;
const sameSet=(a:string[],b:string[])=>a.length===b.length&&a.every(v=>b.includes(v));
/** Separate commercial authentication. Historical pairing expiry is unchanged; only current session authorizes GET. */
export function capturePresentationAuth(readIdentity:()=>LargeMasterSyncV3BoundIdentity=readLargeMasterSyncV3BoundIdentity,readCredentials:()=>TerminalCredentials=readTerminalCredentialsSync,now=Date.now()):PresentationAuth{
 const read=(at:number)=>{
  const identity=readIdentity(),credentials=readCredentials(),base=validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl),origin=new URL(base).origin;
  const token=(v:unknown)=>typeof v==='string'&&v.trim()===v&&v.length>0&&!/[\r\n\t]/.test(v);
  need((credentials.erpTenantId||credentials.tenantId)===identity.tenantId&&(credentials.erpTerminalId||credentials.terminalId)===identity.terminalId&&credentials.deviceId===identity.deviceId&&credentials.syncToken===identity.syncToken&&token(identity.syncToken)&&token(credentials.deviceToken)&&credentials.companyId&&credentials.storeId&&!credentials.identityMigrationRequired&&['AUTHENTICATED','BOUND','ERP_ACTIVE'].includes(credentials.authStatus||'')&&['ERP_REGISTER','ERP_REGISTER_REAUTH','ERP_REGISTER_REFRESH','ERP_AUTH_REAUTH','ERP_AUTH_REFRESH'].includes(credentials.deviceTokenSource||'')&&credentials.syncTokenExpiresAt&&Date.parse(credentials.syncTokenExpiresAt)>at&&(!credentials.deviceTokenExpiresAt||Number.isFinite(Date.parse(credentials.deviceTokenExpiresAt))),'INVENTORY_PRESENTATION_AUTH_REQUIRED');
  const fingerprint=canonicalPresentationJson([identity,credentials.companyId,credentials.storeId,credentials.deviceToken,credentials.syncTokenExpiresAt,credentials.deviceTokenExpiresAt??null,credentials.authStatus,credentials.deviceTokenSource]);
  return {origin,identity,credentials,fingerprint};
 };
 const current=read(now),{origin,identity,credentials}=current;
 return {origin,scope:{tenantId:identity.tenantId,companyId:credentials.companyId!,storeId:credentials.storeId!,terminalId:identity.terminalId,deviceId:identity.deviceId},headers:{Authorization:`Bearer ${identity.syncToken}`,'X-Sync-Token':identity.syncToken,'X-Tenant-Id':identity.tenantId,'X-Terminal-Id':identity.terminalId,'X-Device-Id':identity.deviceId,'X-Device-Token':credentials.deviceToken!,'X-Clic-Inventory-Presentations':'1'},assertCurrent(){need(read(Date.now()).fingerprint===current.fingerprint,'INVENTORY_PRESENTATION_AUTH_CHANGED');}};
}
export async function validatePresentationContext(value:any,expected:PresentationAuthority):Promise<PresentationContext>{
 need(exact(value,['schemaVersion','contract','scope','tariffIds','categories','inventoryQuantityUnit','contextRevision','returnPolicy','mastersUrl'])&&value.schemaVersion===1&&value.contract==='INVENTORY_PRESENTATIONS_V1'&&value.inventoryQuantityUnit==='BASE'&&value.returnPolicy==='SOURCE_REQUIRED_NOT_YET_SUPPORTED'&&value.mastersUrl===PRESENTATIONS_ROOT+'/masters'&&hash(value.contextRevision));
 need(exact(value.scope,[...scopeKeys])&&scopeKeys.every(k=>typeof value.scope[k]==='string'&&value.scope[k].length>0&&value.scope[k]===expected.scope[k])&&strings(value.tariffIds)&&value.tariffIds.length>0&&sameSet(value.tariffIds,expected.tariffIds)&&strings(value.categories)&&sameSet(value.categories,expected.categories),'INVENTORY_PRESENTATION_SCOPE_CHANGED');
 const {contextRevision,returnPolicy:_policy,mastersUrl:_url,...body}=value;need(await inventoryPresentationRevision(body)===contextRevision,'INVENTORY_PRESENTATION_CONTEXT_HASH_INVALID');return JSON.parse(canonicalPresentationJson(value));
}
export async function validatePresentationPage(value:any,context:PresentationContext,after:string|null):Promise<PresentationPage>{
 need(exact(value,['schemaVersion','contract','contextRevision','items','checksum','nextAfter'])&&value.schemaVersion===1&&value.contract==='INVENTORY_PRESENTATIONS_V1'&&value.contextRevision===context.contextRevision&&Array.isArray(value.items)&&value.items.length<=200&&hash(value.checksum)&&(value.nextAfter===null||uuid(value.nextAfter)&&(!after||value.nextAfter>after)));
 need(await inventoryPresentationRevision(value.items)===value.checksum,'INVENTORY_PRESENTATION_PAGE_HASH_INVALID');
 let last=after;for(const item of value.items){await validateInventoryPresentationMaster(item,{contextRevision:context.contextRevision});need(sameSet(item.basePrices.map((p:any)=>p.tariffId),context.tariffIds),'INVENTORY_PRESENTATION_TARIFF_FORBIDDEN');need(uuid(item.itemId)&&(!last||item.itemId>last)&&(value.nextAfter===null||item.itemId<=value.nextAfter),'INVENTORY_PRESENTATION_PAGE_ORDER_INVALID');last=item.itemId;}
 return JSON.parse(canonicalPresentationJson(value));
}
export function createInventoryPresentationClient(options:{store:InventoryPresentationStore;authority:()=>PresentationAuthority;auth?:()=>PresentationAuth;fetchImpl?:typeof fetch;sessionId:()=>string;timeoutMs?:number;maxPages?:number}){
 let pending:Promise<PresentationContext>|null=null,generation=0,controller:AbortController|undefined;
 const authProvider=options.auth||capturePresentationAuth;
 async function download():Promise<PresentationContext>{
  const version=generation,auth=authProvider(),expected=JSON.parse(canonicalPresentationJson(options.authority())) as PresentationAuthority;
  need(auth.origin===expected.origin&&Object.entries(auth.scope).every(([key,value])=>expected.scope[key as keyof PresentationScope]===value),'INVENTORY_PRESENTATION_SCOPE_CHANGED');
  const bindingKey=await inventoryPresentationRevision({origin:expected.origin,scope:expected.scope});
  const assertCurrent=()=>{auth.assertCurrent();need(version===generation&&!controller?.signal.aborted&&canonicalPresentationJson(options.authority())===canonicalPresentationJson(expected),'INVENTORY_PRESENTATION_CONTEXT_CHANGED');};
  controller=new AbortController();const signal=controller.signal,sessionId=options.sessionId();let begun=false;
  async function request(path:string,method:'GET'|'POST'){
   assertCurrent();const timeout=new AbortController(),abort=()=>timeout.abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,options.timeoutMs??8000);
   try{const response=await (options.fetchImpl||fetch)(auth.origin+path,{method,headers:{...auth.headers,'X-Clic-Inventory-Presentations':'1',Accept:'application/json','Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{}),signal:timeout.signal,redirect:'error',credentials:'omit',cache:'no-store'});assertCurrent();need(!response.redirected&&new URL(response.url||auth.origin+path).origin===auth.origin,'INVENTORY_PRESENTATION_REDIRECT_FORBIDDEN');if(!response.ok)throw Error(response.status===401||response.status===403?'INVENTORY_PRESENTATION_AUTH_REQUIRED':`INVENTORY_PRESENTATION_HTTP_${response.status}`);need(response.headers.get('X-Clic-Inventory-Presentations')==='1','INVENTORY_PRESENTATION_UNSUPPORTED');const body=await response.json();assertCurrent();return body;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  try{
   const context=await validatePresentationContext(await request(PRESENTATIONS_ROOT+'/negotiate','POST'),expected);assertCurrent();await options.store.migrate();await options.store.begin(sessionId,bindingKey,auth.origin,context);begun=true;
   let after:string|null=null;const seen=new Set<string>();
   for(let index=0;index<(options.maxPages??1000);index++){
    const params=new URLSearchParams({contextRevision:context.contextRevision,limit:'200',...(after?{after}:{})});
    const page=await validatePresentationPage(await request(context.mastersUrl+'?'+params,'GET'),context,after);assertCurrent();
    for(const item of page.items){need(!seen.has(item.itemId),'INVENTORY_PRESENTATION_DUPLICATE_ITEM');seen.add(item.itemId);}
    await options.store.stage(sessionId,index,page);assertCurrent();
    if(page.nextAfter===null){await options.store.publish(sessionId,assertCurrent);assertCurrent();return context;}
    after=page.nextAfter;
   }throw Error('INVENTORY_PRESENTATION_PAGE_LIMIT');
  }catch(error){if(begun)await options.store.discard(sessionId);throw error;}
 }
 return {
  prepare():Promise<PresentationContext>{if(pending)return pending;const operation=download().finally(()=>{if(pending===operation)pending=null;});pending=operation;return operation;},
  cancel(){generation++;controller?.abort();},
  async cached(){
   const version=generation,auth=authProvider(),expected=JSON.parse(canonicalPresentationJson(options.authority())) as PresentationAuthority;
   const assertCurrent=()=>{auth.assertCurrent();need(version===generation&&canonicalPresentationJson(options.authority())===canonicalPresentationJson(expected),'INVENTORY_PRESENTATION_CONTEXT_CHANGED');};
   assertCurrent();need(auth.origin===expected.origin&&Object.entries(auth.scope).every(([key,value])=>expected.scope[key as keyof PresentationScope]===value),'INVENTORY_PRESENTATION_SCOPE_CHANGED');
   await options.store.migrate();assertCurrent();
   const bindingKey=await inventoryPresentationRevision({origin:expected.origin,scope:expected.scope});assertCurrent();
   const cached=await options.store.active(bindingKey);assertCurrent();if(!cached)return null;
   await validatePresentationContext(cached.context,expected);assertCurrent();return {...cached,bindingKey};
  },
 };
}
