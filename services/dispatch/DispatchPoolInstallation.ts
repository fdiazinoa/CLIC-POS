import type {DispatchPoolSnapshot} from '../db/CompanyDispatchPool';
import {canonicalDispatchJSON} from '../db/CompanyDispatchEscrowStore';
import {nativeDispatchWitnessPreferences} from './DispatchDeliveryWitness';
import {dbAdapter} from '../db';
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
type PoolPort={readLocal(bindingId:string,generation:string):Promise<{witnessHash:string;nativeSchemaHash:string}|null>;readWitness(key:string):Promise<string|null>;writeWitness(key:string,value:string):Promise<void>;install(snapshot:DispatchPoolSnapshot,witnessHash:string,nativeSchemaHash:string,previouslySeen:boolean):Promise<string>};
/** The snapshot comes exclusively from the bound ERP status transport. This
 * coordinator establishes the external ownership witness before SQLite. A
 * witness without SQLite is reconciliation, not permission to reset a cursor. */
async function installOnce(snapshot:DispatchPoolSnapshot,nativeSchemaHash:string,port:PoolPort):Promise<string>{
 const binding=snapshot?.binding;if(!binding?.id||!binding.generation||!/^[a-f0-9]{64}$/.test(nativeSchemaHash))throw Error('DISPATCH_POOL_SNAPSHOT_INVALID');
 const key='clic.dispatch.pool.owner.v1.'+binding.id+'.'+binding.generation;
 const [local,encoded]=await Promise.all([port.readLocal(binding.id,binding.generation),port.readWitness(key)]);
 let witness:{version:number;bindingId:string;generation:string;nonce:string}|null=null;
 if(encoded!==null){try{witness=JSON.parse(encoded);}catch{throw Error('DISPATCH_POOL_EXTERNAL_WITNESS_CORRUPT');}if(witness?.version!==1||witness.bindingId!==binding.id||witness.generation!==binding.generation||!/^[a-f0-9]{64}$/.test(witness.nonce))throw Error('DISPATCH_POOL_EXTERNAL_WITNESS_CORRUPT');}
 if(local){if(!witness||local.witnessHash!==await hash(witness.nonce)||local.nativeSchemaHash!==nativeSchemaHash)throw Error('DISPATCH_POOL_LOCAL_OWNERSHIP_CONFLICT');return port.install(snapshot,local.witnessHash,nativeSchemaHash,true);}
 if(witness||snapshot.barrier?.proof?.nativePoolWitnessHash||binding.accepted_sequence!==0)throw Error('DISPATCH_POOL_RECONCILIATION_REQUIRED');
 witness={version:1,bindingId:binding.id,generation:binding.generation,nonce:Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')};
 const value=JSON.stringify(witness);await port.writeWitness(key,value);if(await port.readWitness(key)!==value)throw Error('DISPATCH_POOL_EXTERNAL_WITNESS_NOT_DURABLE');
 return port.install(snapshot,await hash(witness.nonce),nativeSchemaHash,false);
}
const pending=new Map<string,{snapshot:string;promise:Promise<string>}>();
export async function installNativeDispatchPool(snapshot:DispatchPoolSnapshot,nativeSchemaHash:string,port:PoolPort):Promise<string>{
 const key=snapshot?.binding?.id+':'+snapshot?.binding?.generation,identity=canonicalDispatchJSON([snapshot,nativeSchemaHash]),old=pending.get(key);
 if(old){if(old.snapshot!==identity)throw Error('DISPATCH_POOL_CONCURRENT_SNAPSHOT_CHANGED');return old.promise;}
 const promise=installOnce(snapshot,nativeSchemaHash,port);pending.set(key,{snapshot:identity,promise});try{return await promise;}finally{if(pending.get(key)?.promise===promise)pending.delete(key);}
}
export async function installBoundNativeDispatchPool(snapshot:DispatchPoolSnapshot,nativeSchemaHash:string):Promise<string>{
 if(!dbAdapter.readDispatchPoolInstallation||!dbAdapter.installDispatchPoolSnapshot)throw Error('DISPATCH_NATIVE_POOL_UNSUPPORTED');
 return installNativeDispatchPool(snapshot,nativeSchemaHash,{...nativeDispatchWitnessPreferences,readLocal:(binding,generation)=>dbAdapter.readDispatchPoolInstallation!(binding,generation),install:(...args)=>dbAdapter.installDispatchPoolSnapshot!(...args)});
}
