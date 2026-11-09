import {Preferences} from '@capacitor/preferences';
import {verifyDispatchQuotaDelivery,type DispatchQuotaDelivery,type DispatchScope} from './DispatchAuthority';
type Snapshot={delivery:DispatchQuotaDelivery;delivered:boolean;witnessHash:string|null};
type Port={readLocal(id:string):Promise<{authorityCanonical:string;authorityHash:string;witnessHash:string}|null>;readWitness(key:string):Promise<string|null>;writeWitness(key:string,value:string):Promise<void>;claim(quotaId:string,witnessHash:string):Promise<{quotaId:string;authorityHash:string;witnessHash:string;firstInstallationAllowed:boolean;deliveredAtEpochMs?:number}>;install(delivery:DispatchQuotaDelivery,previouslySeen:boolean,witnessHash:string,clock?:import('../db/CompanyDispatchEscrowStore').DispatchDeliveryClock):Promise<void>};
export const nativeDispatchWitnessPreferences={async readWitness(key:string){return(await Preferences.get({key})).value;},async writeWitness(key:string,value:string){await Preferences.set({key,value});}};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
async function acceptOnce(snapshot:Snapshot,scope:DispatchScope,port:Port):Promise<void>{
 const delivery=snapshot.delivery;await verifyDispatchQuotaDelivery(delivery,scope);const key='clic.dispatch.owner.v1.'+delivery.id;
 const [local,raw]=await Promise.all([port.readLocal(delivery.id),port.readWitness(key)]);
 let witness:{schemaVersion:number;quotaId:string;authorityHash:string;nonce:string}|undefined;
 if(raw!==null){try{witness=JSON.parse(raw);}catch{throw Error('DISPATCH_EXTERNAL_WITNESS_CORRUPT');}if(witness?.schemaVersion!==1||witness.quotaId!==delivery.id||witness.authorityHash!==delivery.authorityHash||!/^[a-f0-9]{64}$/.test(witness.nonce))throw Error('DISPATCH_EXTERNAL_WITNESS_CORRUPT');}
 if(local){if(!witness||local.authorityCanonical!==delivery.authorityCanonical||local.authorityHash!==delivery.authorityHash||local.witnessHash!==await hash(witness.nonce)||snapshot.delivered&&snapshot.witnessHash!==local.witnessHash)throw Error('DISPATCH_LOCAL_OWNERSHIP_MISMATCH');await port.install(delivery,true,local.witnessHash);return;}
 if(witness||snapshot.delivered||snapshot.witnessHash)throw Error('DISPATCH_LOCAL_OWNERSHIP_MISSING');
 const bytes=crypto.getRandomValues(new Uint8Array(32));witness={schemaVersion:1,quotaId:delivery.id,authorityHash:delivery.authorityHash,nonce:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')};
 const encoded=JSON.stringify(witness);await port.writeWitness(key,encoded);if(await port.readWitness(key)!==encoded)throw Error('DISPATCH_EXTERNAL_WITNESS_NOT_DURABLE');
 const witnessHash=await hash(witness.nonce),localRequestStartedMs=Date.now(),claim=await port.claim(delivery.id,witnessHash),localReceivedMs=Date.now();
 if(claim.quotaId!==delivery.id||claim.authorityHash!==delivery.authorityHash||claim.witnessHash!==witnessHash||claim.firstInstallationAllowed!==true)throw Error('DISPATCH_FIRST_DELIVERY_RECONCILIATION_REQUIRED');
 await port.install(delivery,false,witnessHash,delivery.trackingClockSource?{serverDeliveredMs:Number(claim.deliveredAtEpochMs),localRequestStartedMs,localReceivedMs}:undefined);
}
const pending=new Map<string,{hash:string;promise:Promise<void>}>();
export async function acceptDispatchDelivery(snapshot:Snapshot,scope:DispatchScope,port:Port):Promise<void>{
 const key=snapshot.delivery.id,old=pending.get(key);if(old){if(old.hash!==snapshot.delivery.authorityHash)throw Error('DISPATCH_DELIVERY_CONCURRENT_CONFLICT');return old.promise;}
 const promise=acceptOnce(snapshot,scope,port);pending.set(key,{hash:snapshot.delivery.authorityHash,promise});try{await promise;}finally{if(pending.get(key)?.promise===promise)pending.delete(key);}
}
