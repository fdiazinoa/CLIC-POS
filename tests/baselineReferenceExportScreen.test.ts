import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatManualSyncFailure } from '../utils/manualSyncDiagnostic';
import { BaselineReferenceRowTooLargeError, REFERENCE_AUDIT_PAGE_BYTES, type BaselineReferenceInventory } from '../services/diagnostics/BaselineReferenceInventory';
import { createBaselineReferenceWriter, runBaselineReferenceExport } from '../services/diagnostics/SaveBaselineReferenceInventory';

const summary:BaselineReferenceInventory={schemaVersion:2,startedAt:'start',completedAt:'end',scanComplete:true,referenceInventoryComplete:true,migrationAllowed:false,tableCount:3,rowCount:100,referenceCount:200,balanceCount:1,versionCount:2,issueCount:0,pageCount:10};
function fakeFilesystem() {
 const files=new Map<string,string>();const writes:number[]=[];let appending=false,overlap=false;
 const fs={
  writeFile:async(o:{path:string;data:string})=>{files.set(o.path,o.data);return {uri:o.path};},
  appendFile:async(o:{path:string;data:string})=>{if(appending)overlap=true;appending=true;await Promise.resolve();writes.push(new TextEncoder().encode(o.data).length);files.set(o.path,(files.get(o.path)||'')+o.data);appending=false;},
  rename:async(o:{from:string;to:string})=>{files.set(o.to,files.get(o.from)||'');files.delete(o.from);},
  deleteFile:async(o:{path:string})=>{if(!files.delete(o.path))throw Error('File does not exist');},
 };
 return {files,writes,fs,overlap:()=>overlap};
}

test('native writer streams bounded batches, publishes only after commit and identity check',async()=>{
 const f=fakeFilesystem();let committed=false,maxPreview=0;
 const result=await runBaselineReferenceExport({
  readBinding:()=> 'same',readIdentity:()=>({terminalId:'Master-01'}),createWriter:()=>createBaselineReferenceWriter(f.fs as any,true),
  onPreview:preview=>{maxPreview=Math.max(maxPreview,new TextEncoder().encode(preview).length);},
  read:async options=>{for(let i=0;i<3000;i++){await options.emitLine(JSON.stringify({type:'reference',value:'😀'.repeat(100),i})+'\n');options.onProgress?.({table:'documents',rows:i,references:i});}assert.ok([...f.files.keys()].every(path=>path.endsWith('.partial')));committed=true;return summary;},
 });
 assert.equal(committed,true);assert.equal(f.files.size,1);assert.match(result.path,/\.jsonl$/);
 const content=[...f.files.values()][0].trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(content[0].identity.terminalId,'Master-01');assert.equal(content.at(-1).type,'complete');assert.equal(content.length,3002);
 assert.ok(Math.max(...f.writes)<=32768);assert.ok(maxPreview<=8192);assert.equal(f.overlap(),false);
});

test('permission failure stops before reading SQLite',async()=>{
 let read=false;
 await assert.rejects(runBaselineReferenceExport({readBinding:()=> 'same',readIdentity:()=>({terminalId:'M'}),createWriter:async()=>{throw Error('permission denied');},read:async()=>{read=true;return summary;}}),/permission/);
 assert.equal(read,false);
});

test('read failure, write failure, cancellation and identity drift never publish a final report',async()=>{
 for(const mode of ['read','write','cancel','binding']){
  const f=fakeFilesystem();const controller=new AbortController();let binding='same';
  if(mode==='write')f.fs.appendFile=async()=>{throw Error('disk full');};
  await assert.rejects(runBaselineReferenceExport({
   readBinding:()=>binding,readIdentity:()=>({terminalId:'M'}),signal:controller.signal,createWriter:()=>createBaselineReferenceWriter(f.fs as any,true),
   read:async options=>{
    await options.emitLine(JSON.stringify({type:'reference',text:'x'.repeat(30000)})+'\n');
    if(mode==='read')throw Error('read failed');
    if(mode==='write')await options.emitLine(JSON.stringify({type:'reference',text:'x'.repeat(30000)})+'\n');
    if(mode==='cancel')controller.abort();if(mode==='binding')binding='changed';return summary;
   },
  }),/read failed|disk full|CANCELLED|BINDING_CHANGED/);
  assert.equal(f.files.size,0);
 }
});

test('lost rename response and cancellation or binding drift during rename clean both owned names',async()=>{
 for(const mode of ['lost','cancel','binding']){
  const f=fakeFilesystem(),controller=new AbortController();let binding='same';
  const rename=f.fs.rename;
  f.fs.rename=async options=>{await rename(options);if(mode==='lost')throw Error('rename response lost');if(mode==='cancel')controller.abort();if(mode==='binding')binding='changed';};
  await assert.rejects(runBaselineReferenceExport({readBinding:()=>binding,readIdentity:()=>({terminalId:'M'}),signal:controller.signal,createWriter:()=>createBaselineReferenceWriter(f.fs as any,true),read:async()=>summary}),/rename response lost|CANCELLED|BINDING_CHANGED/);
  assert.equal(f.files.size,0);
 }
});

test('cleanup failure is explicit rather than claiming no final file exists',async()=>{
 const f=fakeFilesystem();const rename=f.fs.rename;
 f.fs.rename=async options=>{await rename(options);throw Error('lost response');};
 f.fs.deleteFile=async()=>{throw Error('permission denied');};
 await assert.rejects(runBaselineReferenceExport({readBinding:()=> 'same',readIdentity:()=>({terminalId:'M'}),createWriter:()=>createBaselineReferenceWriter(f.fs as any,true),read:async()=>summary}),/REFERENCE_AUDIT_REPORT_CLEANUP_FAILED/);
});

test('fallible preview callback executes before final publication',async()=>{
 const f=fakeFilesystem();await assert.rejects(runBaselineReferenceExport({readBinding:()=> 'same',readIdentity:()=>({terminalId:'M'}),createWriter:()=>createBaselineReferenceWriter(f.fs as any,true),read:async()=>summary,onPreview:()=>{throw Error('observer failed');}}),/observer failed/);assert.equal(f.files.size,0);
});

const source=readFileSync(new URL('../components/SyncSettings.tsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('SyncSettings.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function handler(name:string){let result:ts.Expression|undefined;function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)===name)result=node.initializer;ts.forEachChild(node,find);}find(parsed);assert.ok(result);return ts.transpileModule(`(${result.getText(parsed)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}

test('screen displays oversized table and safe budget, blocks double start, and resets busy state',async()=>{
 let message='',busy=false;const controller:{current:AbortController|null}={current:null};let reads=0;
 const run=runInNewContext(handler('handleExportReferences'),{
  isExportingReferences:false,isSyncing:false,referenceExportController:controller,referenceExportMounted:{current:true},AbortController,
  setIsExportingReferences:(value:boolean)=>{busy=value;},setReferenceExportJson:()=>{},setReferenceExportMessage:(value:string)=>{message=value;},
  dbAdapter:{masterSyncV3Store:{readBaselineReferenceInventory:()=>{}}},readOperationalTerminalBinding:()=> 'same',readOperationalCatalogBindingProof:()=>({terminalId:'M'}),
  runBaselineReferenceExport:async()=>{reads++;await Promise.resolve();throw new BaselineReferenceRowTooLargeError('documents',200000);},BaselineReferenceRowTooLargeError,REFERENCE_AUDIT_PAGE_BYTES,formatManualSyncFailure,
 });const pending=run();await run();await pending;assert.equal(reads,1);assert.equal(busy,false);assert.equal(controller.current,null);assert.match(message,/documents/);assert.match(message,/131072/);assert.match(message,/sin recortar/);
 assert.doesNotMatch(source,/JSON\.stringify\(\{ \.\.\.report|Guardar JSON|Inventario completo de referencias locales V3/);
 assert.match(source,/Cancelar exportación/);assert.match(source,/referenceExportController\.current\?\.abort\(\)/);
});

test('screen offers manual copy when clipboard is absent or rejects',async()=>{
 for(const clipboard of [undefined,{writeText:async()=>{throw Error('denied');}}]){
  let message='';const run=runInNewContext(handler('handleCopyReferenceJson'),{navigator:{clipboard},referenceExportJson:'preview only',setReferenceExportMessage:(value:string)=>{message=value;}});await run();assert.match(message,/manualmente/);
 }
});
