import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatManualSyncFailure } from '../utils/manualSyncDiagnostic';

const source=readFileSync(new URL('../components/SyncSettings.tsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('SyncSettings.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler:ts.Expression|undefined;
function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)==='handleExportReferences')handler=node.initializer;ts.forEachChild(node,find);}find(parsed);assert.ok(handler);

async function click(mode:'ok'|'read-failure'|'save-failure'|'identity-change'|'incomplete'){
 const states={json:'',message:'',busy:false,saves:0};let reads=0;
 const report={schemaVersion:1,tables:[{name:'documents',rows:601}],references:[{table:'documents',row:{doc_id:'SALE'}}],issues:mode==='incomplete'?[{kind:'MALFORMED_JSON'}]:[],referenceInventoryComplete:mode!=='incomplete',migrationAllowed:false};
 const run=runInNewContext(ts.transpileModule(`(${handler!.getText(parsed)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
  isExportingReferences:false,isSyncing:false,setIsExportingReferences:(value:boolean)=>{states.busy=value;},setReferenceExportJson:(value:string)=>{states.json=value;},setReferenceExportMessage:(value:string)=>{states.message=value;},
  readOperationalTerminalBinding:()=>mode==='identity-change'&&reads++>0?'changed':'same',
  readOperationalCatalogBindingProof:()=>({terminalId:'Master-01',deviceId:'DEVICE',companyId:'COMPANY',tenantId:'TENANT'}),
  dbAdapter:{masterSyncV3Store:{readBaselineReferenceInventory:async()=>{if(mode==='read-failure')throw Error('SQLITE_READ_ERROR');return report;}}},
  saveBaselineReferenceInventory:async()=>{states.saves++;if(mode==='save-failure')throw Error('permission');return 'Documents/Download/report.json';},
  formatManualSyncFailure,
 });await run();return states;
}

test('screen exports the whole report locally and includes the bound identity',async()=>{
 const state=await click('ok');assert.equal(state.busy,false);assert.equal(state.saves,1);
 const exported=JSON.parse(state.json);assert.equal(exported.identity.terminalId,'Master-01');assert.equal(exported.migrationAllowed,false);
 assert.match(state.message,/Documents\/Download\/report.json/);
});

test('file save failure keeps the complete JSON available for copy',async()=>{
 const state=await click('save-failure');assert.equal(state.busy,false);assert.ok(JSON.parse(state.json));assert.match(state.message,/copiar|Copiar/);
});

test('read errors and identity changes never export partial or misbound JSON',async()=>{
 for(const mode of ['read-failure','identity-change'] as const){const state=await click(mode);assert.equal(state.json,'');assert.equal(state.saves,0);assert.equal(state.busy,false);assert.match(state.message,/SQLITE_READ_ERROR|SYNC_V3_BINDING_CHANGED/);}
});

test('screen labels incomplete coverage explicitly rather than claiming a complete inventory',async()=>{
 const state=await click('incomplete');assert.equal(JSON.parse(state.json).referenceInventoryComplete,false);assert.match(state.message,/incidencias/);
});

test('copy keeps a manual fallback when clipboard is absent or rejects',async()=>{
 let copyHandler:ts.Expression|undefined;
 function findCopy(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)==='handleCopyReferenceJson')copyHandler=node.initializer;ts.forEachChild(node,findCopy);}findCopy(parsed);assert.ok(copyHandler);
 for(const clipboard of [undefined,{writeText:async()=>{throw Error('denied');}}]){
  let message='';
  const run=runInNewContext(ts.transpileModule(`(${copyHandler.getText(parsed)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
   navigator:{clipboard},referenceExportJson:'{"migrationAllowed":false}',setReferenceExportMessage:(value:string)=>{message=value;},
  });
  await run();assert.match(message,/manualmente/);
 }
});
