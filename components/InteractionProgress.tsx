import React,{forwardRef,useImperativeHandle,useRef,useState,useEffect} from 'react';

export interface InteractionProgressHandle {
 show(message:string,onCancel?:()=>void):void;
 lock():void;
 hide():void;
}
/** A small independent render: feedback is not destination readiness or financial success. */
const InteractionProgress=forwardRef<InteractionProgressHandle>((_,ref)=>{
 const [progress,setProgress]=useState<{message:string;cancellable:boolean}|null>(null);
 const cancellation=useRef<(()=>void)|undefined>(undefined);
 useImperativeHandle(ref,()=>({show(message,onCancel){cancellation.current=onCancel;setProgress({message,cancellable:Boolean(onCancel)});},lock(){cancellation.current=undefined;setProgress(current=>current?{...current,cancellable:false}:null);},hide(){cancellation.current=undefined;setProgress(null);}}),[]);
 useEffect(()=>()=>{cancellation.current?.();cancellation.current=undefined;},[]);
 if(!progress)return null;
 return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 p-4" aria-busy="true">
  <div className="rounded-2xl bg-white p-5 shadow-xl flex items-center gap-4">
   <p role="status" aria-live="polite" className="font-semibold text-slate-800">{progress.message}</p>
   {progress.cancellable&&<button type="button" className="rounded-xl border border-slate-300 px-4 py-2 font-semibold" onClick={()=>{const cancel=cancellation.current;cancellation.current=undefined;cancel?.();setProgress(null);}}>Cancelar</button>}
  </div>
 </div>;
});
InteractionProgress.displayName='InteractionProgress';
export default InteractionProgress;

/** Two frame callbacks give the independent feedback a rendering opportunity, with no timer delay. */
export async function yieldInteractionPaint():Promise<void>{
 if(typeof requestAnimationFrame==='undefined')return;
 await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
}
