import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {RECOVER_OTHER_SELLER_PARKED_SALES} from '../utils/directSaleParkedTickets';
import {canViewTicketHistory} from '../utils/ticketHistoryPermission';
const source=(name:string)=>ts.createSourceFile(name,readFileSync(new URL('../'+name,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
function declaration(file:ts.SourceFile,name:string){let found:ts.Expression|undefined;const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)found=node.initializer;ts.forEachChild(node,visit);};visit(file);assert.ok(found,name);return found!;}
function evaluate(expression:ts.Expression,scope:Record<string,unknown>){const js=ts.transpileModule('const callback='+expression.getText()+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;return new Function(...Object.keys(scope),js+'return callback;')(...Object.values(scope));}
const app=source('App.tsx'),history=source('components/TicketHistory.tsx');
test('actual central history entrypoint rejects direct and retained callbacks after role revocation',()=>{
 let updates=0;const access={current:{currentUser:{id:'u',role:'CUSTOM'},roles:[{id:'CUSTOM',permissions:['POS_VIEW_TICKET_HISTORY']}]}};
 const origin={current:'POS'};const open=evaluate(declaration(app,'openTicketHistory'),{ticketHistoryAccessRef:access,canViewTicketHistory,historyReturnViewRef:origin,setScanTargetTicketId:()=>updates++,setCurrentView:()=>updates++});
 open('SETTINGS','ticket');assert.equal(updates,2);assert.equal(origin.current,'SETTINGS');
 access.current.roles[0].permissions=[];open('POS','ticket');assert.equal(updates,2);
 access.current.currentUser=null as any;open();assert.equal(updates,2);
});
test('actual historical print handler blocks before IO and rechecks after an asynchronous read',async()=>{
 let reads=0,prints=0;const historyAccess={current:{view:false,reprint:false,identity:'u'}};
 let release:(value:unknown)=>void=()=>{};let deferred=false;
 const print=evaluate(declaration(history,'handlePrintTransaction'),{historyAccess,db:{getDocument:async()=>{reads++;if(deferred)return new Promise(resolve=>release=resolve);return {id:'sale',payments:[]};}},printTicket:async()=>prints++,printIntegratedPaymentArtifacts:async()=>{prints++;return {voucherCopiesFailed:[]};},config:{},alert:()=>{}});
 await print({id:'sale'});assert.equal(reads,0);assert.equal(prints,0);
 historyAccess.current={view:true,reprint:false,identity:'u'};await print({id:'sale'});assert.equal(reads,0);
 historyAccess.current={view:true,reprint:true,identity:'u'};await print({id:'sale'});assert.equal(prints,1);
 deferred=true;const pending=print({id:'sale'});await Promise.resolve();historyAccess.current={view:false,reprint:false,identity:'revoked'};release({id:'sale',payments:[]});await pending;assert.equal(prints,1);
});
test('actual history wrapper denies mounting without permission and survives StrictMode layout replay',()=>{
 let ref:any;let setup:(()=>void|(()=>void))|undefined;
 const wrapper=evaluate(declaration(history,'TicketHistory'),{canViewTicketHistory,
  canReprintTicketHistory:()=>false,useMemo:(factory:()=>unknown)=>factory(),useRef:(initial:unknown)=>ref||(ref={current:initial}),
  React:{createElement:(type:unknown,props:unknown)=>({type,props}),useLayoutEffect:(effect:()=>void|(()=>void))=>{setup=effect;}},AuthorizedTicketHistory:()=>null});
 const props={currentUser:{id:'u',roleId:'ROLE',role:'ADMIN'},roles:[{id:'ROLE',permissions:[]}]};
 assert.equal(wrapper(props),null);assert.equal(ref.current.view,false);
 props.roles[0].permissions=['POS_VIEW_TICKET_HISTORY'] as any;
 const mounted=wrapper(props);assert.ok(mounted);const layoutSetup=setup!;
 const cleanup=layoutSetup() as ()=>void;assert.equal(ref.current.view,true);
 cleanup();assert.equal(ref.current.view,false);layoutSetup();assert.equal(ref.current.view,true,'StrictMode second child passive load sees permission restored');
 props.roles[0].permissions=[];assert.equal(wrapper(props),null);assert.equal(ref.current.view,false,'revocation blocks old child callbacks synchronously');
});
test('editable ALL roles retain wildcard semantics and cannot silently revoke other capabilities',()=>{
 const team=source('components/TeamHub.tsx');let updated:any;
 const roles=[{id:'CUSTOM',permissions:['ALL','POS_EXTRA']}];
 const toggle=evaluate(declaration(team,'togglePermission'),{erpManaged:false,roles,RECOVER_OTHER_SELLER_PARKED_SALES,editingRole:null,setEditingRole:()=>{},onUpdateRoles:(value:any)=>updated=value,setRoleSaveStatus:()=>{}});
 toggle('CUSTOM','POS_VIEW_TICKET_HISTORY');assert.deepEqual(updated,roles);
 roles[0].permissions=['POS_CHECKOUT','POS_VIEW_TICKET_HISTORY'];toggle('CUSTOM','POS_VIEW_TICKET_HISTORY');
 assert.deepEqual(updated[0].permissions,['POS_CHECKOUT']);
});
