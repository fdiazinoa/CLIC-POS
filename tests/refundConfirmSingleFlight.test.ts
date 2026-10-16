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

test('cashier without void permission can see supervisor above RefundModal and cancel or authorize without releasing single-flight early',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const {default:SupervisorModal}=await import('../components/SupervisorModal');const {RefundModal}=await import('../components/RefundModal');
 const hookSource=readFileSync(new URL('../hooks/useSupervisorAuth.ts',import.meta.url),'utf8');
 const code=(await transform(hookSource.slice(hookSource.indexOf('export const useSupervisorAuth')).replace('export const','const'),{loader:'ts'})).code;
 const cells:any[]=[];let cursor=0;const useState=(initial:any)=>{const index=cursor++;if(!(index in cells))cells[index]=initial;return[cells[index],(value:any)=>{cells[index]=value;}];};
 const create=new Function('useState','useCallback','requiresTerminalPolicyPin','canGrantDiscountPercent',`${code};return useSupervisorAuth;`);
 const hook=create(useState,(fn:any)=>fn,()=>false,()=>false),staff:any={id:'staff',roleId:'cashier'},supervisor:any={id:'supervisor',roleId:'supervisor',pin:'9999'};
 const roles:any=[{id:'cashier',permissions:[]},{id:'supervisor',permissions:['POS_VOID_PAID_TICKET']}],props:any={config:{auditLogs:[]},currentUser:staff,roles,onUpdateConfig:()=>{}};
 const renderHook=()=>{cursor=0;return hook(props);};let auth=renderHook(),effects=0;
 const refund=await handler(async()=>{const approved=await auth.requestApproval({permission:'POS_VOID_PAID_TICKET',actionDescription:'Return'});if(approved)effects++;});
 const pending=refund.run();await refund.run();auth=renderHook();assert.equal(auth.supervisorModalProps.isOpen,true);assert.equal(refund.ref.current,true);
 const html=renderToStaticMarkup(React.createElement(React.Fragment,null,
  React.createElement(RefundModal,{isOpen:true,onClose:()=>{},onConfirm:async()=>{},transaction:{id:'sale',items:[],status:'COMPLETED'} as any,currencySymbol:'RD$'}),
  React.createElement(SupervisorModal,{...auth.supervisorModalProps,users:[staff,supervisor],overlayZIndex:170})));
 assert.match(html,/z-\[110\]/);assert.match(html,/z-index:170/);assert.match(readFileSync(new URL('../components/TicketHistory.tsx',import.meta.url),'utf8'),/SupervisorModal[^>]+overlayZIndex=\{170\}/);
 auth.supervisorModalProps.onClose();await pending;assert.equal(refund.ref.current,false);assert.equal(effects,0);
 auth=renderHook();const approved=refund.run();auth=renderHook();
 const supervisorSource=readFileSync(new URL('../components/SupervisorModal.tsx',import.meta.url),'utf8');
 const segment=supervisorSource.slice(supervisorSource.indexOf('    const handleAuthorize ='),supervisorSource.indexOf('\n    return ('));
 const authorizeCode=(await transform(segment,{loader:'ts'})).code;
 const authorize=new Function('f',`const {users,roles,pin,requiredPermission,requestedDiscountPercent,onAuthorize,setPin,setError}=f;${authorizeCode};return handleAuthorize;`)({users:[staff,supervisor],roles,pin:'9999',requiredPermission:'POS_VOID_PAID_TICKET',onAuthorize:auth.supervisorModalProps.onAuthorize,setPin:()=>{},setError:()=>{}});
 authorize();await approved;assert.equal(effects,1);assert.equal(refund.ref.current,false);assert.equal(renderHook().supervisorModalProps.isOpen,false);
});
