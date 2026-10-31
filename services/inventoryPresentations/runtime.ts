import {assertInventoryPresentationEligible} from './eligibility';
import {assertPresentationAdmission,beginPresentationAdmission,finishPresentationAdmission} from './admission';
import type {CartItem} from '../../types';
import {createUuid} from '../../utils/uuid';
import {dbAdapter} from '../db';
import {createInventoryPresentationClient,type PresentationAuthority,type PresentationAuth} from './client';
import {InventoryPresentationStore,type PresentationSQL} from './store';
import {canonicalPresentationJson,inventoryPresentationRevision,validateInventoryPresentation} from './contract';

export {presentationAuthority} from './authority';
export const isTransientPresentationFailure=(error:unknown)=>/network|fetch|timeout|abort|INVENTORY_PRESENTATION_HTTP_(?:408|429|5\d{2})\b/i.test(String(error));
/** Only an ERP answer disables the local presentations; a scope/config divergence must not poison the cache. */
export const isErpPresentationDenial=(error:unknown)=>/INVENTORY_PRESENTATION_(ERP_DENIED|UNSUPPORTED|AUTH_REQUIRED|HTTP_(?:401|403))\b/i.test(String(error));
export function createPresentationRuntime(authority:()=>PresentationAuthority,ports:{sql?:PresentationSQL;auth?:()=>PresentationAuth;fetchImpl?:typeof fetch;sessionId?:()=>string}={}){
 const sql=ports.sql??dbAdapter.inventoryPresentationsSQL?.();if(!sql)throw Error('INVENTORY_PRESENTATION_NATIVE_REQUIRED');
 const store=new InventoryPresentationStore(sql),raw=createInventoryPresentationClient({store,authority,sessionId:ports.sessionId??createUuid,...(ports.auth?{auth:ports.auth}:{}),...(ports.fetchImpl?{fetchImpl:ports.fetchImpl}:{})});
 let generation=0;
 const client={...raw,cancel(){generation++;raw.cancel();},async prepare(){
  const version=generation,expected=authority(),lease=beginPresentationAdmission(expected);
  return raw.prepare().catch(async error=>{
   if(version!==generation)throw error;
   if(isTransientPresentationFailure(error)){
    try{const cached=await raw.cached();if(cached&&version===generation&&canonicalPresentationJson(authority())===canonicalPresentationJson(expected))return cached.context;}catch{/* A known denial or invalid session never authorizes fallback. */}
    throw error;
   }
   // A mismatched local scope (for example a stale sales warehouse) is not an ERP denial:
   // keeping the previous cache lets a corrected configuration recover without a reinstall.
   if(isErpPresentationDenial(error))await store.deny(await inventoryPresentationRevision({origin:expected.origin,scope:expected.scope}));
   throw error;
  }).finally(()=>finishPresentationAdmission(lease));
 },async cached(){assertPresentationAdmission(authority());return raw.cached();}};
 return {store,client};
}
export type PresentationRuntime=ReturnType<typeof createPresentationRuntime>;

/** Capture only retained bytes; selected master revisions remain frozen across later refreshes. */
export async function validatePresentationCart(runtime:PresentationRuntime,lines:CartItem[]){
 const selected=lines.filter(line=>line.inventoryPresentation!==undefined);if(!selected.length)return;
 for(const line of selected)assertInventoryPresentationEligible(line);
 const active=await runtime.client.cached();if(!active)throw Error('INVENTORY_PRESENTATION_CACHE_REQUIRED');
 const masters:Record<string,string>={},retained:Record<string,import('./contract').InventoryPresentationMaster>={};
 const revisions=Array.from(new Set(selected.map(line=>line.inventoryPresentation!.masterRevision)));
 for(let index=0;index<revisions.length;index+=200)Object.assign(retained,await runtime.store.retainedMany(active.contextKey,revisions.slice(index,index+200)));
 for(const line of selected){
  const descriptor=line.inventoryPresentation!;
  if(line.quantity<=0||line.variantId||line.variantSku||descriptor.itemId!==line.id||descriptor.tariffId!==line.v3SaleAuthority?.tariffId||line.v3SaleAuthority?.warehouseId!==active.context.scope.warehouseId)throw Error('INVENTORY_PRESENTATION_SOURCE_REQUIRED_NOT_YET_SUPPORTED');
  const master=retained[descriptor.masterRevision];if(!master)throw Error('INVENTORY_PRESENTATION_MASTER_REQUIRED');
  await validateInventoryPresentation({...line,inventoryPresentation:descriptor},master);masters[master.masterRevision]=canonicalPresentationJson(master);
 }
 // Session and complete-context scope must still match after asynchronous retained reads.
 const current=await runtime.client.cached();if(!current||canonicalPresentationJson(current.context)!==canonicalPresentationJson(active.context))throw Error('INVENTORY_PRESENTATION_CONTEXT_CHANGED');
 return {sessionId:active.sessionId,bindingKey:active.bindingKey,contextKey:active.contextKey,contextContent:canonicalPresentationJson({origin:active.origin,context:active.context}),masters};
}
export type PresentationCommitProof=NonNullable<Awaited<ReturnType<typeof validatePresentationCart>>>;

