/** Ephemeral capability from an authenticated response on the existing master transport.
 * Unknown/old backends remain OFF. No flag/config rewrite or V2 preflight is needed. */
let accepted:{key:string;expires:number}|null=null;
const listeners=new Set<()=>void>();
export function subscribeFiscalWorkflowCapability(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
const notify=()=>{for(const listener of listeners)listener();};
const key=(base:string,h:Record<string,string>)=>JSON.stringify([new URL(base).origin,h['X-Tenant-Id'],h['X-Terminal-Id'],h['X-Device-Id'],h['X-Sync-Token'],h['X-Device-Token']]);
export function observeFiscalWorkflowCapability(base:string,headers:Record<string,string>,value:string|null,now=Date.now(),ttlMs=300000){
 const nextKey=key(base,headers),wasCurrent=accepted?.key===nextKey&&accepted.expires>now;
 if(value==='2')accepted={key:nextKey,expires:now+(Number.isFinite(ttlMs)?Math.max(0,Math.min(300000,ttlMs)):0)};else accepted=null;
 if(value!=='2'||!wasCurrent)notify();
}
export function hasFiscalWorkflowCapability(base:string,headers:Record<string,string>,now=Date.now()):boolean{return Boolean(accepted&&accepted.key===key(base,headers)&&accepted.expires>now);}
export function clearFiscalWorkflowCapability(){accepted=null;notify();}
