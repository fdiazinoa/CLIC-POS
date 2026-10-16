import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
async function handler(onConfirm:()=>Promise<unknown>){
 const source=readFileSync(new URL('../components/RefundModal.tsx',import.meta.url),'utf8');
 const segment=source.slice(source.indexOf('    const handleConfirm ='),source.indexOf('\n    return (',source.indexOf('    const handleConfirm =')));
 const code=(await transform(segment,{loader:'ts'})).code;
 const ref={current:false},states:boolean[]=[],errors:string[]=[];
 const create=new Function('f',`const {submittingRef,setSubmitting,setSubmitError,transaction,refundQuantities,itemConditions,reason,onConfirm}=f;${code};return handleConfirm;`);
 return{ref,states,errors,run:create({submittingRef:ref,setSubmitting:(value:boolean)=>states.push(value),setSubmitError:(value:string)=>errors.push(value),transaction:{items:[{cartId:'L',quantity:1}]},refundQuantities:new Map([['L',1]]),itemConditions:new Map(),reason:'Return',onConfirm})};
}
test('same-tick duplicate Confirm spans slow approval/preparation/commit and finally unlocks',async()=>{
 let release!:()=>void,calls=0;const pending=new Promise<void>(resolve=>release=resolve);
 const f=await handler(async()=>{calls++;await pending;});
 const first=f.run(),second=f.run();await second;assert.equal(calls,1);assert.equal(f.ref.current,true);assert.deepEqual(f.states,[true]);
 release();await first;assert.equal(f.ref.current,false);assert.deepEqual(f.states,[true,false]);
});
for(const stage of ['fresh-original','approval','prepare','commit'])test(`Confirm surfaces ${stage} failure and clears busy before retry`,async()=>{
 let calls=0;const f=await handler(async()=>{calls++;throw Error(`failed-${stage}`);});
 await f.run();assert.equal(f.ref.current,false);assert.equal(f.errors.at(-1),`failed-${stage}`);assert.deepEqual(f.states,[true,false]);
 await f.run();assert.equal(calls,2);
});
