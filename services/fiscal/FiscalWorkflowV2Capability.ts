/** Ephemeral capability from an authenticated response on the existing master transport.
 * Unknown/old backends remain OFF. No flag/config rewrite or V2 preflight is needed. */
let accepted:{key:string;expires:number}|null=null;
const key=(base:string,h:Record<string,string>)=>JSON.stringify([new URL(base).origin,h['X-Tenant-Id'],h['X-Terminal-Id'],h['X-Device-Id'],h['X-Sync-Token']]);
export function observeFiscalWorkflowCapability(base:string,headers:Record<string,string>,value:string|null,now=Date.now()){
 if(value==='2')accepted={key:key(base,headers),expires:now+300000};else accepted=null;
}
export function hasFiscalWorkflowCapability(base:string,headers:Record<string,string>,now=Date.now()):boolean{return Boolean(accepted&&accepted.key===key(base,headers)&&accepted.expires>now);}
export function clearFiscalWorkflowCapability(){accepted=null;}
