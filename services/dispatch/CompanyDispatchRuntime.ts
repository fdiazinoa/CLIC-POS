import {dbAdapter} from '../db';
import type {DatabaseAdapter} from '../db/DatabaseAdapter';
import {createLargeMasterSyncV3BoundTransport,readLargeMasterSyncV3BoundIdentity,validatedLargeMasterSyncV3ErpSyncBase} from '../sync/LargeMasterSyncV3BoundTransport';
import type {LargeMasterSyncV3Transport,V3BoundRequestBody} from '../sync/LargeMasterSyncV3Client';
import type {DispatchPoolSnapshot} from '../db/CompanyDispatchPool';
import {installBoundNativeDispatchPool} from './DispatchPoolInstallation';
import {acceptDispatchDelivery,nativeDispatchWitnessPreferences} from './DispatchDeliveryWitness';
import type {DispatchQuotaDelivery} from './DispatchAuthority';
import {createUuid} from '../../utils/uuid';
export type DispatchNativeSnapshot=DispatchPoolSnapshot&{rows:Array<{delivery:DispatchQuotaDelivery;delivered:boolean;witnessHash:string|null}>;snapshotSequence:number;nextSequence:number;hasMore:boolean};
async function body<T>(transport:LargeMasterSyncV3Transport,path:string,command?:V3BoundRequestBody):Promise<T>{const response=await transport.request(path,{method:command?'POST':'GET',...(command?{body:command}:{})});if(response.status!==200)throw Error('DISPATCH_NATIVE_AUTHORITY_UNAVAILABLE');let value;try{value=JSON.parse(response.text);}catch{throw Error('DISPATCH_NATIVE_AUTHORITY_INVALID');}return value;}
/** Operational producer: status -> durable FROZEN witness -> local drain proof ->
 * server barrier ACK. Only a later authoritative STABLE policy can enable quota.
 * No provider/fiscal/payment call occurs in this synchronization path. */
export async function synchronizeNativeCompanyDispatch(transport?:LargeMasterSyncV3Transport,database:DatabaseAdapter=dbAdapter,installPool=installBoundNativeDispatchPool,witness=nativeDispatchWitnessPreferences):Promise<{state:string;installedQuotas:number}>{
 if(!database.dispatchNativeSchemaHash||!database.installDispatchPoolSnapshot||!database.prepareDispatchBarrierProof||!database.installDispatchQuota||!database.readDispatchQuota)throw Error('DISPATCH_NATIVE_AUTHORITY_UNSUPPORTED');
 if(!transport){const identity=readLargeMasterSyncV3BoundIdentity(),base=validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl);transport=createLargeMasterSyncV3BoundTransport(new URL(base).origin);}
 let snapshot=await body<DispatchNativeSnapshot>(transport,'/api/sync/v3/company-dispatch');
 if(snapshot?.contractVersion!==1||!snapshot.policy)throw Error('DISPATCH_NATIVE_AUTHORITY_INVALID');
 if(!snapshot.binding){if(snapshot.policy.effective_mode==='IMMEDIATE'&&snapshot.policy.phase==='STABLE')return{state:'IMMEDIATE',installedQuotas:0};throw Error('DISPATCH_NATIVE_BINDING_REQUIRED');}
 const schemaHash=await database.dispatchNativeSchemaHash(),poolId=await installPool(snapshot,schemaHash);
 const command=async<T>(action:'claimQuota'|'ackQuotaInstalled'|'acceptBarrier',fields:Record<string,unknown>)=>body<T>(transport!,'/api/sync/v3/company-dispatch',{action,requestKey:createUuid(),bindingId:snapshot.binding.id,generation:snapshot.binding.generation,...fields});
 if(snapshot.policy.phase==='PREPARING'){
  if(snapshot.barrier?.state!=='DRAINED'){
   const proof=await database.prepareDispatchBarrierProof(snapshot);
   const ack=await command<{barrierId:string;state:string;generation:string}>('acceptBarrier',{barrierId:snapshot.barrier?.id,nonce:snapshot.barrier?.nonce,proof});
   if(ack.barrierId!==snapshot.barrier?.id||ack.state!=='DRAINED'||ack.generation!==snapshot.binding.generation)throw Error('DISPATCH_NATIVE_BARRIER_ACK_CONFLICT');
  }
  return{state:'FROZEN',installedQuotas:0};
 }
 if(snapshot.policy.effective_mode!=='WAREHOUSE_DISPATCH')return{state:'IMMEDIATE',installedQuotas:0};
 let installedQuotas=0,after=0;const until=snapshot.snapshotSequence;const binding=JSON.stringify(snapshot.binding),policy=JSON.stringify(snapshot.policy);
 for(;;){
  if(!Array.isArray(snapshot.rows)||snapshot.rows.length>100||!Number.isSafeInteger(snapshot.nextSequence)||snapshot.nextSequence<after||snapshot.snapshotSequence!==until)throw Error('DISPATCH_NATIVE_DELIVERY_PAGE_INVALID');
  for(const row of snapshot.rows){
   const delivery=row.delivery,b=snapshot.binding;
   const scope={...delivery.scope,tenantId:b.tenant_id,companyId:b.company_id,storeId:b.store_id,terminalId:b.terminal_id,deviceId:b.device_id,bindingId:b.id,generation:b.generation};
   await acceptDispatchDelivery(row,scope,{...witness,readLocal:id=>database.readDispatchQuota!(id),claim:(quotaId,witnessHash)=>command('claimQuota',{quotaId,witnessHash,authorityHash:delivery.authorityHash,nativeSchemaHash:schemaHash}),install:(value,seen,witness)=>database.installDispatchQuota!(value,scope,poolId,seen,witness)});
   const installed=await database.readDispatchQuota!(delivery.id);if(!installed)throw Error('DISPATCH_NATIVE_DELIVERY_INSTALL_REQUIRED');
   const ack=await command<{quotaId:string;installed:boolean;authorityHash:string;generation:string}>('ackQuotaInstalled',{quotaId:delivery.id,authorityHash:delivery.authorityHash,witnessHash:installed.witnessHash,nativeSchemaHash:schemaHash});
   if(ack.quotaId!==delivery.id||ack.installed!==true||ack.authorityHash!==delivery.authorityHash||ack.generation!==b.generation)throw Error('DISPATCH_NATIVE_DELIVERY_ACK_CONFLICT');installedQuotas++;
  }
  if(!snapshot.hasMore)break;
  if(snapshot.nextSequence<=after)throw Error('DISPATCH_NATIVE_DELIVERY_PAGE_INVALID');after=snapshot.nextSequence;
  snapshot=await body<DispatchNativeSnapshot>(transport,`/api/sync/v3/company-dispatch?after=${after}&until=${until}`);
  if(JSON.stringify(snapshot.binding)!==binding||JSON.stringify(snapshot.policy)!==policy)throw Error('DISPATCH_NATIVE_SNAPSHOT_CHANGED');
 }
 return{state:'WAREHOUSE_DISPATCH',installedQuotas};
}
