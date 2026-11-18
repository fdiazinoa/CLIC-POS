import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildAuthoritativeErpSecuritySnapshot } from '../utils/erpSecuritySnapshot';
import { resolvePosUserId,explicitlyRemovesPosUser } from '../utils/posUserReconciliation';

const source=readFileSync(new URL('../services/sync/SyncManager.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('SyncManager.ts',source,ts.ScriptTarget.Latest,true);
const declaration=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='SyncManager') as ts.ClassDeclaration;assert.ok(declaration);
const names=new Set(['erpSecurityApplyQueue','refreshTerminalStructuredMasterData','snapshotMasterRows','collectSnapshotMasterRows','snapshotPosUserId','snapshotExplicitlyRemovesPosUser','applyAuthoritativeErpSecuritySnapshot']);
const code=ts.transpileModule('class Subject {'+declaration.members.filter(member=>member.name&&names.has(member.name.getText(ast))).map(member=>member.getText(ast)).join('\n')+'}; return Subject;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const roles=[{id:'CASHIER',name:'Cajero',permissions:['POS_CHECKOUT'],isActive:true,syncSource:'ERP_SNAPSHOT'},{id:'ADMIN',name:'Admin',permissions:['POS_CHECKOUT','POS_CLOSE_Z'],isActive:true,syncSource:'ERP_SNAPSHOT'},{id:'SUPERVISOR',name:'Supervisor',permissions:['POS_DISCOUNT'],isActive:true,syncSource:'ERP_SNAPSHOT'}];
const users=Array.from({length:9},(_,index)=>({id:`U${index}`,name:`Operador ${index}`,pin:String(1000+index),role:'CASHIER',roleId:'CASHIER',isActive:true,syncSource:'ERP_SNAPSHOT',version:3}));
const tombstone=(id:string)=>({id,_op:'DELETE',can_operate_pos:false,is_active:false,isActive:false});
function fixture(){
 const values=new Map<string,any>([['roles',structuredClone(roles)],['users',structuredClone(users)],['transactions',[{id:'SALE',total:300}]],['inventoryLedger',[{id:'MOVE',qtyOut:1}]]]);
 const writes:string[]=[],events:string[]=[];let beforeRead:((name:string)=>Promise<void>)|undefined;let failSave=false;
 const db={get:async(name:string)=>{await beforeRead?.(name);return structuredClone(values.get(name));},save:async(name:string,value:any)=>{writes.push(name);if(failSave&&name==='users'){failSave=false;throw Error('disk fault');}values.set(name,structuredClone(value));}};
 const Constructor=new Function('db','syncPolicy','buildAuthoritativeErpSecuritySnapshot','resolvePosUserId','explicitlyRemovesPosUser','persistProductionAreaSnapshot','posCatalogDebugNow','posCatalogDebugElapsedMs','posCatalogDebugLog','window','CustomEvent','console',code)(db,{resolve:()=>({kind:'ERP_ACTIVE'})},buildAuthoritativeErpSecuritySnapshot,resolvePosUserId,explicitlyRemovesPosUser,async()=>{},()=>0,()=>0,()=>{},{dispatchEvent:(event:{type:string})=>events.push(event.type)},class {constructor(public type:string){}},{info:()=>{}});
 const manager=new Constructor();manager.applyTerminalCatalogClassifications=async()=>({categories:0,productGroups:0});manager.normalizeSnapshotPurchaseOrder=()=>null;manager.normalizeSnapshotTransfer=()=>null;
 const apply=(snapshot:any,scopes?:any,assertCurrent?:()=>Promise<void>)=>manager.refreshTerminalStructuredMasterData(snapshot,null,{masterScopes:scopes,assertCurrent,terminalIds:['Master-01']});
 return {manager,values,writes,events,apply,beforeRead:(hook:(name:string)=>Promise<void>)=>{beforeRead=hook;},fail:()=>{failSave=true;}};
}

test('catalog-only request with one appended unknown tombstone preserves nine login users and all roles',async()=>{
 const f=fixture(),before=structuredClone([...f.values]);
 await f.apply({masters:{pos_users:[tombstone('DESCATALOGUED-USER')]}},[]);
 assert.deepEqual([...f.values],before);assert.deepEqual(f.writes,[]);assert.deepEqual(f.events,[]);
 assert.match(source,/refreshTerminalStructuredMasterData\(snapshot, catalogDelta, \{[\s\S]*?masterScopes: securityMasterScopes/);
});

test('an explicit known removal revokes only that user, is idempotent and never alters business records',async()=>{
 const f=fixture(),business=JSON.stringify([f.values.get('transactions'),f.values.get('inventoryLedger')]);
 await f.apply({masters:{pos_users:[tombstone('U3')]}},['items']);
 assert.deepEqual(f.values.get('users'),users.filter(user=>user.id!=='U3'));assert.deepEqual(f.values.get('roles'),roles);assert.deepEqual(f.events,['usersUpdated']);
 await f.apply({masters:{users:[tombstone('U3'),tombstone('U3'),tombstone('unknown')]}},[]);
 assert.equal(f.values.get('users').length,8);assert.deepEqual(f.events,['usersUpdated']);assert.equal(JSON.stringify([f.values.get('transactions'),f.values.get('inventoryLedger')]),business);
});

for(const alias of ['users','pos_users'])test(`full requested ${alias} empty remains an authoritative revocation`,async()=>{
 const f=fixture();await f.apply({masters:{[alias]:[]}},[alias]);assert.deepEqual(f.values.get('users'),[]);assert.deepEqual(f.values.get('roles'),roles);assert.deepEqual(f.events,['usersUpdated']);
});

test('full empty security, and legacy undefined/null scopes, retain full-snapshot semantics',async()=>{
 for(const scopes of [undefined,null,['users','roles']]){const f=fixture();await f.apply({masters:{users:[],roles:[]}},scopes);assert.deepEqual(f.values.get('users'),[]);assert.deepEqual(f.values.get('roles'),[]);}
});

test('roles-only authority cannot replace users with an unsolicited tombstone-only array',async()=>{
 for(const alias of ['roles','pos_roles']){
  const f=fixture();await f.apply({masters:{[alias]:roles,pos_users:[tombstone('absent')]}},[alias]);assert.deepEqual(f.values.get('users'),users);assert.deepEqual(f.writes,['roles']);
  await f.apply({masters:{[alias]:roles,pos_users:[tombstone('U0')]}},[alias]);assert.equal(f.values.get('users').length,8);assert.ok(f.values.get('users').every((user:any)=>user.id!=='U0'));
 }
});

for(const bad of [[{id:'UNSOLICITED',name:'Unexpected',pin:'1234',roleId:'CASHIER'}],[{_op:'DELETE'}],[null],[{id:'U0',_op:'UPSERT'}],{},'none'])test(`unsolicited malformed/positive user data fails without erasing or granting (${JSON.stringify(bad)})`,async()=>{
 const f=fixture(),before=structuredClone([...f.values]);await assert.rejects(f.apply({masters:{pos_users:bad}},[]),/fuera de alcance|seguridad ERP inválido/);assert.deepEqual([...f.values],before);assert.deepEqual(f.writes,[]);
});

test('malformed or unsolicited nonempty roles are not granted even when accompanied by valid user removals',async()=>{
 for(const bad of [[...roles],[{id:'CASHIER',_op:'DELETE'}],{},null]){
  const f=fixture(),before=structuredClone([...f.values]);await assert.rejects(f.apply({masters:{pos_roles:bad,pos_users:[tombstone('U1')]}},[]),/fuera del alcance|seguridad ERP inválido/);assert.deepEqual([...f.values],before);assert.deepEqual(f.events,[]);
 }
});

test('none/omitted security leaves catalogs intact; invalid scope shapes fail closed',async()=>{
 const f=fixture();await f.apply({masters:{items:[]}},[]);assert.deepEqual(f.values.get('users'),users);
 for(const scopes of ['users',[1],{}])await assert.rejects(f.apply({masters:{pos_users:[tombstone('U1')]}},scopes),/Alcance de seguridad/);
 assert.deepEqual(f.values.get('users'),users);
});

for(const fullFirst of [false,true])test(`serialized full/partial security updates never resurrect a fully revoked user (${fullFirst})`,async()=>{
 const f=fixture();let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let first=true;
 f.beforeRead(async name=>{if(name==='users'&&first){first=false;entered();await gate;}});
 const full=()=>f.apply({masters:{users:[]}},['users']),partial=()=>f.apply({masters:{pos_users:[tombstone('U0')]}},[]);
 const firstUpdate=fullFirst?full():partial();await waiting;const secondUpdate=fullFirst?partial():full();release();await Promise.all([firstUpdate,secondUpdate]);assert.deepEqual(f.values.get('users'),[]);
 await partial();assert.deepEqual(f.values.get('users'),[]);
});

test('a rejected snapshot or storage failure does not poison the security lane or overwrite a newer revocation',async()=>{
 const f=fixture();await assert.rejects(f.apply({masters:{users:[{id:'unexpected'}]}},[]),/fuera de alcance/);
 f.fail();await assert.rejects(f.apply({masters:{users:[]}},['users']),/disk fault/);assert.deepEqual(f.values.get('users'),users);
 await f.apply({masters:{users:[]}},['users']);await f.apply({masters:{pos_users:[tombstone('U0')]}},[]);assert.deepEqual(f.values.get('users'),[]);
});

test('a properly scoped full security snapshot can restore the empty authorized roster without demo fallback',async()=>{
 const f=fixture();f.values.set('users',[]);await f.apply({masters:{pos_users:users,pos_roles:roles}},['pos_users','pos_roles']);assert.equal(f.values.get('users').length,9);assert.ok(f.values.get('users').every((user:any)=>user.syncSource==='ERP_SNAPSHOT'));
});


test('queued security authority is checked inside its lane and again before writing',async()=>{
 const f=fixture();let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let first=true;
 f.beforeRead(async name=>{if(name==='users'&&first){first=false;entered();await gate;}});
 const firstUpdate=f.apply({masters:{users:[tombstone('U0')]}},[]);await waiting;
 let valid=true;const second=f.apply({masters:{users:[]}},['users'],async()=>{if(!valid)throw Error('BINDING_CHANGED');});valid=false;release();await firstUpdate;
 await assert.rejects(second,/BINDING_CHANGED/);assert.equal(f.values.get('users').length,8);assert.deepEqual(f.writes,['users']);
 await f.apply({masters:{users:[]}},['users']);assert.deepEqual(f.values.get('users'),[]);
 const g=fixture();let count=0;await assert.rejects(g.apply({masters:{users:[]}},['users'],async()=>{if(++count===2)throw Error('BINDING_CHANGED');}),/BINDING_CHANGED/);assert.deepEqual(g.writes,[]);assert.deepEqual(g.events,[]);assert.deepEqual(g.values.get('users'),users);
});


test('a roles-only carrier can revoke a role and its explicit user together without dropping other users',async()=>{
 const f=fixture();const current=structuredClone(users);current[0].role='SUPERVISOR';current[0].roleId='SUPERVISOR';f.values.set('users',current);
 const remainingRoles=roles.filter(role=>role.id!=='SUPERVISOR');
 await f.apply({masters:{pos_roles:remainingRoles,pos_users:[tombstone('U0')]}},['roles']);
 assert.deepEqual(f.values.get('users'),current.slice(1));assert.deepEqual(f.values.get('roles').map((role:any)=>role.id),remainingRoles.map(role=>role.id));
 assert.deepEqual(f.events,['rolesUpdated','usersUpdated']);
});
