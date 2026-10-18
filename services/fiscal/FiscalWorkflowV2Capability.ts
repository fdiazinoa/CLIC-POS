/** Ephemeral capability from an authenticated response on the existing master transport.
 * Unknown/old backends remain OFF. Capability permits discovery, never a format sale. */
let accepted:{key:string;expires:number}|null=null;
let revision=0;
let expiryTimer:ReturnType<typeof setTimeout>|undefined;
const listeners=new Set<()=>void>();
const key=(base:string,h:Record<string,string>)=>JSON.stringify([new URL(base).origin,h['X-Tenant-Id'],h['X-Terminal-Id'],h['X-Device-Id'],h['X-Sync-Token']]);
const changed=()=>{revision++;for(const listener of [...listeners])listener();};
export const subscribeFiscalWorkflowCapability=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const fiscalWorkflowCapabilityRevision=()=>revision;
export function observeFiscalWorkflowCapability(base:string,headers:Record<string,string>,value:string|null,now=Date.now()){
 const next=value==='2'?{key:key(base,headers),expires:now+300000}:null;
 const notify=accepted?.key!==next?.key||Boolean(accepted&&accepted.expires<=now);
 accepted=next;
 if(expiryTimer)clearTimeout(expiryTimer);
 if(next){expiryTimer=setTimeout(()=>{accepted=null;expiryTimer=undefined;changed();},300000);(expiryTimer as any).unref?.();}
 if(notify)changed();
}
export function hasFiscalWorkflowCapability(base:string,headers:Record<string,string>,now=Date.now()):boolean{return Boolean(accepted&&accepted.key===key(base,headers)&&accepted.expires>now);}
export function clearFiscalWorkflowCapability(){if(expiryTimer)clearTimeout(expiryTimer);expiryTimer=undefined;if(accepted){accepted=null;changed();}}
