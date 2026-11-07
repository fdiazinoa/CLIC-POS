import {createLargeMasterSyncV3BoundTransport,readLargeMasterSyncV3BoundIdentity,validatedLargeMasterSyncV3ErpSyncBase} from '../sync/LargeMasterSyncV3BoundTransport';
import type {LargeMasterSyncV3Transport} from '../sync/LargeMasterSyncV3Client';
import type {DispatchAdoptionProof} from '../db/CompanyDispatchAdoption';
/** Deliberately bypasses the LAN/master transport. Only the ERP bound-terminal
 * endpoint may supply retained adoption receipts for local escrow captures. */
export async function readDispatchAdoptionProofs(eventIds:string[],transport?:LargeMasterSyncV3Transport):Promise<DispatchAdoptionProof[]>{
 if(!eventIds.length)return [];
 if(eventIds.length>50||new Set(eventIds).size!==eventIds.length)throw Error('DISPATCH_ACK_BATCH_INVALID');
 if(!transport){const identity=readLargeMasterSyncV3BoundIdentity(),base=validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl);transport=createLargeMasterSyncV3BoundTransport(new URL(base).origin);}
 const response=await transport.request('/api/sync/v3/company-dispatch',{method:'POST',body:{action:'readAdoptionProofs',eventIds}});
 if(response.status!==200)throw Error('DISPATCH_ERP_ADOPTION_UNAVAILABLE');
 let body;try{body=JSON.parse(response.text);}catch{throw Error('DISPATCH_ERP_ADOPTION_INVALID');}
 if(!Array.isArray(body?.proofs)||body.proofs.length>eventIds.length||body.proofs.some((proof:DispatchAdoptionProof)=>!eventIds.includes(proof?.sourceEventId))||new Set(body.proofs.map((proof:DispatchAdoptionProof)=>proof.sourceEventId)).size!==body.proofs.length)throw Error('DISPATCH_ERP_ADOPTION_INVALID');
 return body.proofs;
}
