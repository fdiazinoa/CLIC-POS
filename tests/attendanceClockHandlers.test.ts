import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {nativeFixture} from './articleFormatsNativeFixture';
import {authenticateAttendancePin,attendanceScopeKey,createAttendanceOperation,createLocalAttendanceRepository,type AttendanceScope} from '../services/attendance/LocalAttendance';
const source=readFileSync(new URL('../components/TeamHub.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('TeamHub.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find<T extends ts.Node>(predicate:(node:ts.Node)=>node is T):T[]{const result:T[]=[];function visit(node:ts.Node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(ast);return result;}
function variable(name:string){const declaration=find((node):node is ts.VariableDeclaration=>ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)[0];assert.ok(declaration?.initializer,name);return declaration.initializer;}
function evaluate(node:ts.Node,scope:Record<string,unknown>){const js=ts.transpileModule('const value='+node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(scope),js+';return value;')(...Object.values(scope));}
const scope:AttendanceScope={mode:'LOCAL_ONLY',localTerminalId:'terminal',deviceId:'device'};
const a={id:'employee-a',name:'Synthetic A',pin:'1234',role:'cashier'},b={id:'employee-b',name:'Synthetic B',pin:'5678',role:'cashier'};
function fixture(repository:ReturnType<typeof createLocalAttendanceRepository>){
 const view={records:[] as any[],alerts:[] as string[],error:null as string|null,busy:false};
 const bindings:any={repository,authenticateAttendancePin,attendanceScopeKey,createAttendanceOperation,clockLoading:false,attendanceScope:scope,users:[a,b],erpManaged:false,pin:'1234',authenticatedUser:a,clockGeneration:{current:1},clockChallenge:{current:1},savingPunch:{current:false},pendingPunches:{current:new Map()},currentClock:{current:{users:[a,b],erpManaged:false,attendanceScope:scope,authenticatedUser:a,pin:'1234'}},setClockError:(value:string|null)=>{view.error=value;},setClockBusy:(value:boolean)=>{view.busy=value;},setTimeRecords:(update:(rows:any[])=>any[])=>{view.records=update(view.records);},setAuthenticatedUser:(value:any)=>{bindings.authenticatedUser=value;},setPin:(value:any)=>{bindings.pin=typeof value==='function'?value(bindings.pin):value;},alert:(message:string)=>{view.alerts.push(message);}};
 const action=evaluate(variable('handleClockAction'),bindings);
 const cancelNode=find((node):node is ts.JsxAttribute=>ts.isJsxAttribute(node)&&node.name.getText(ast)==='onClick'&&node.initializer?.getText(ast).includes('if (savingPunch.current) return; clockChallenge.current++')===true)[0];assert.ok(cancelNode);const cancel=evaluate((cancelNode.initializer as ts.JsxExpression).expression!,bindings);
 const login=(pin:string)=>{for(const key of pin)evaluate(variable('handlePinPress'),bindings)(key);};
 return {view,bindings,action,cancel,login};
}
test('actual clock handler blocks repeated callbacks and confirms only after native persistence/readback',async()=>{
 const f=await nativeFixture();try{const repo=createLocalAttendanceRepository(f.adapter);let release!:()=>void,calls=0;const gate=new Promise<void>(resolve=>{release=resolve;});const ui=fixture({...repo,commit:async record=>{calls++;await gate;return repo.commit(record);}});
 const first=ui.action('IN',1);await ui.action('IN',1);assert.equal(calls,1);assert.equal(ui.view.alerts.length,0);assert.equal(ui.view.busy,true);release();await first;assert.equal((await repo.load(scope)).length,1);assert.equal(ui.view.records.length,1);assert.equal(ui.view.alerts.length,1);assert.equal(ui.view.busy,false);await ui.action('IN',1);assert.equal(calls,1);
 }finally{f.db.close();}
});
test('actual cancel/new PIN rejects an old slider challenge while failed original employee can retry unchanged ID',async()=>{
 const f=await nativeFixture();try{const repo=createLocalAttendanceRepository(f.adapter);let fail=true;const ui=fixture({...repo,commit:async record=>{const saved=await repo.commit(record);if(fail){fail=false;throw Error('ACK lost');}return saved;}});await ui.action('IN',1);const original=ui.bindings.pendingPunches.current.get(a.id);assert.ok(original);assert.equal(ui.view.alerts.length,0);assert.equal(ui.bindings.currentClock.current.authenticatedUser.id,a.id);
 const unlockNode=find((node):node is ts.JsxAttribute=>ts.isJsxAttribute(node)&&node.name.getText(ast)==='onUnlock'&&node.initializer?.getText(ast).includes("handleClockAction('IN', activeClockChallenge)")===true)[0];assert.ok(unlockNode);let triggered:Promise<unknown>|undefined;const oldUnlock=evaluate((unlockNode.initializer as ts.JsxExpression).expression!,{activeClockChallenge:1,handleClockAction:(...args:unknown[])=>{triggered=ui.action(...args);return triggered;}});
 ui.cancel();ui.login('5678');assert.equal(ui.bindings.currentClock.current.authenticatedUser.id,b.id);const challenge=ui.bindings.clockChallenge.current;
 oldUnlock();await triggered;assert.equal((await repo.load(scope)).length,1);await ui.action('IN',challenge);assert.equal((await repo.load(scope)).length,2);assert.equal(ui.bindings.pendingPunches.current.get(a.id).id,original.id);
 ui.login('1234');await ui.action('IN',ui.bindings.clockChallenge.current);assert.equal((await repo.load(scope)).length,2);assert.deepEqual((await repo.load(scope)).find(row=>row.userId===a.id),original);
 }finally{f.db.close();}
});
test('scope generation change during save prevents stale success/record publication',async()=>{
 const f=await nativeFixture();try{const repo=createLocalAttendanceRepository(f.adapter);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ui=fixture({...repo,commit:async record=>{await gate;return repo.commit(record);}});const pending=ui.action('OUT',1);ui.bindings.clockGeneration.current++;ui.bindings.currentClock.current.attendanceScope={...scope,deviceId:'other'};release();await pending;assert.equal(ui.view.alerts.length,0);assert.equal(ui.view.records.length,0);assert.equal((await repo.load(scope)).length,1);assert.equal((await repo.load({...scope,deviceId:'other'})).length,0);
 }finally{f.db.close();}
});
test('actual persisted-history report groups employee days rather than merging two days into 33 hours',()=>{
 const memo=variable('dailyReports');assert.ok(ts.isCallExpression(memo));const records=['2026-10-19T08:00:00.000Z','2026-10-19T17:00:00.000Z','2026-10-20T08:00:00.000Z','2026-10-20T17:00:00.000Z'].map((timestamp,index)=>createAttendanceOperation(scope,a,index%2?'OUT':'IN',{id:String(index),timestamp}));const reports=evaluate(memo.arguments[0],{users:[a],timeRecords:records})();assert.equal(reports.length,2);assert.deepEqual(reports.map((row:any)=>row.totalHours),['9.00','9.00']);
});
