import {recordCheckoutTrace} from '../audit/CheckoutTrace';

/** Bounded online reconciliation for a quarantined local reserve.
 * Reads/session faults are never resolved by revoking: the downloaded grant stays in place and is
 * revalidated when the ERP answers again. This module only schedules preparation attempts. */
const MAX_ATTEMPTS=5;
let listenerAttached=false,attempt=0,timer:ReturnType<typeof setTimeout>|null=null,running=false,lastNotified='';
const hasWindow=()=>typeof window!=='undefined';
const trace=(kind:'OFFLINE_RESERVE_QUARANTINED'|'OFFLINE_RESERVE_RECOVERED',detail:string)=>{try{recordCheckoutTrace(kind,detail);}catch{/* trace is best effort */}};
const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
const attach=()=>{
 if(listenerAttached||!hasWindow())return;
 listenerAttached=true;
 // `online` is the only signal that new ERP authority can be fetched; it resets the bounded retry.
 window.addEventListener('online',()=>{attempt=0;void reconcileNow('online');});
};
const backoff=()=>{
 if(attempt>=MAX_ATTEMPTS)return;
 const delay=Math.min(30000,1000*2**attempt);
 attempt++;
 clearTimer();
 timer=setTimeout(()=>{timer=null;void reconcileNow('retry');},delay);
};
/** Traces once per distinct cause and arms the online reconciliation. Never mutates fiscal storage. */
export function notifyOfflineFiscalReserveDegraded(code:string):void{
 attach();
 const key=String(code||'OFFLINE_FISCAL_PREPARATION_FAILED');
 if(key===lastNotified)return;
 lastNotified=key;
 trace('OFFLINE_RESERVE_QUARANTINED',key);
 // Offline now: the listener retries as soon as the connection returns.
 if(!hasWindow()||navigator.onLine===false)return;
 void reconcileNow('degraded');
}
/** Single-flight preparation attempt; on success the reserve is usable again and the trace closes. */
export async function reconcileNow(reason:string):Promise<boolean>{
 if(running)return false;
 running=true;
 try{
  const {fiscalWorkflowV2Client}=await import('./FiscalWorkflowV2Client');
  await fiscalWorkflowV2Client.prepareOfflineAuthority();
  const readiness=await fiscalWorkflowV2Client.offlineReadiness();
  if(/^READY/.test(readiness.reason)){
   attempt=0;lastNotified='';
   trace('OFFLINE_RESERVE_RECOVERED',`${reason}: ${readiness.reason}`);
   return true;
  }
  backoff();
  return false;
 }catch{
  backoff();
  return false;
 }finally{running=false;}
}
