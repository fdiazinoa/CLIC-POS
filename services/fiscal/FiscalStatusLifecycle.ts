import type {FiscalStatusReconciler} from './FiscalStatusReconciler';
/** Attach only after successful transaction/history hydration; never calls issue/retry. */
export function attachFiscalStatusLifecycle(worker:Pick<FiscalStatusReconciler,'runAutomatic'|'dispose'>,options:{
  hydrated:boolean;online:()=>boolean;addOnline:(listener:()=>void)=>void;removeOnline:(listener:()=>void)=>void;
  syncTime:string|null;subscribe:(listener:(state:{lastSyncTime:string|null;isSyncing:boolean;hasError:boolean})=>void)=>()=>void;
}):()=>void{
  if(!options.hydrated)return()=>{};
  let disposed=false,last=options.syncTime;
  const run=()=>{if(!disposed&&options.online())void worker.runAutomatic().catch(()=>{});};
  options.addOnline(run);
  const unsubscribe=options.subscribe(state=>{
    if(state.lastSyncTime&&state.lastSyncTime!==last&&!state.isSyncing&&!state.hasError){last=state.lastSyncTime;run();}
  });
  run();
  return()=>{disposed=true;options.removeOnline(run);unsubscribe();worker.dispose();};
}
