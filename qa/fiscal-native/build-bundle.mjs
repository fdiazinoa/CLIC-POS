import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(new URL(import.meta.url).pathname),'../..'),assets=resolve(process.argv[2]||'/tmp/clic-pos-fiscalqa-assets');
if(assets.startsWith(repo+'/'))throw Error('Generated QA assets must live outside repository');
if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('QA bundle requires a frozen clean source checkout');
const ports={
 '../db':'export const dbAdapter=new Proxy({}, {get:(_t,k)=>{const a=globalThis.__fiscalQA.adapter;return typeof a[k]==="function"?a[k].bind(a):a[k];}});',
 '../../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__fiscalQA.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 '../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__fiscalQA.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 './sync/SyncManager':'export const syncManager={broadcastChange:async()=>{}};',
 './CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 './sync/SyncFeatureFlags':'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2";',
 './sync/LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__fiscalQA.session;',
 './LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__fiscalQA.session;export const v3InventoryBaselineKey=(b,s)=>JSON.stringify([b,s.inventorySyncId||s.syncId,s.inventorySyncVersion??s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
 './LargeMasterSyncV3BoundTransport':'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__fiscalQA.identity;export const validatedLargeMasterSyncV3ErpSyncBase=v=>v;export const createLargeMasterSyncV3BoundClient=()=>{throw Error("LAB_NO_NETWORK");};',
 './SyncFeatureFlags':'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2";',
 './DurableOutboxRepository':'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__fiscalQA.adapter.commitFinancialTransaction(i)};',
 '../CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
};
const result=await build({entryPoints:[resolve(repo,'qa/fiscal-native/runner.ts')],absWorkingDir:repo,bundle:true,write:false,format:'iife',platform:'browser',target:['chrome83'],define:{'import.meta.env':'{}'},metafile:true,plugins:[{name:'synthetic-only-ports-real-native-adapter',setup(b){b.onResolve({filter:/.*/},a=>ports[a.path]?{path:a.path,namespace:'lab-ports'}:undefined);b.onLoad({filter:/.*/,namespace:'lab-ports'},a=>({contents:ports[a.path],loader:'js'}));}}]});
const forbidden=Object.keys(result.metafile.inputs).filter(p=>/(?:^|\/)(?:App\.tsx|bootstrap\.tsx|index\.tsx|SupabaseService\.ts)$/.test(p));if(forbidden.length)throw Error('Operational entry imported: '+forbidden.join(','));
await mkdir(resolve(assets,'public'),{recursive:true});const bytes=result.outputFiles[0].contents;await writeFile(resolve(assets,'public/lab.js'),bytes);
const nativePluginFiles=[];async function hashTree(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,item.name);if(item.isDirectory()&&!['build','.gradle'].includes(item.name))await hashTree(path);else if(item.isFile()&&/\.(?:java|kt|gradle|xml)$/.test(item.name))nativePluginFiles.push({path:path.slice(repo.length+1),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}}await hashTree(resolve(repo,'node_modules/@capacitor-community/sqlite/android'));
const manifest={nativePluginFiles,laboratoryOnly:true,packageName:'com.clicpos.fiscalqa',sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),bundleSha256:createHash('sha256').update(bytes).digest('hex'),plugin:JSON.parse(await readFile(resolve(repo,'node_modules/@capacitor-community/sqlite/package.json'),'utf8')).version,metafile:result.metafile,syntheticPorts:Object.keys(ports)};
await writeFile(resolve(assets,'public/provenance.json'),JSON.stringify(manifest,null,2));await writeFile(resolve(assets,'public/index.html'),'<!doctype html><meta name="viewport" content="width=device-width"><title>Fiscal QA laboratory</title><pre id="result">Starting isolated native test…</pre><script src="lab.js"></script>');
await writeFile(resolve(assets,'capacitor.config.json'),JSON.stringify({appId:'com.clicpos.fiscalqa',appName:'Fiscal QA laboratory',webDir:'public',server:{androidScheme:'https'},plugins:{CapacitorSQLite:{androidIsEncryption:false}}}));await writeFile(resolve(assets,'capacitor.plugins.json'),'[]');
console.log(JSON.stringify({sourceSha:manifest.sourceSha,bundleSha256:manifest.bundleSha256,plugin:manifest.plugin,assets,inputs:Object.keys(result.metafile.inputs).length},null,2));
