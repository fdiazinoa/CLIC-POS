import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isV3CatalogHint} from '../services/sync/LargeMasterSyncV3ManifestCheckpoint';
import {SyncTriggerCoordinator} from '../services/sync/SyncTriggerCoordinator';
const text=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback:any;
function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='syncTriggerCoordinator.configure')callback=n.arguments[0];ts.forEachChild(n,visit);}visit(ast);
function fixture(v3=true){
 const manifests:any[]=[],legacy:string[]=[];let wait:()=>Promise<boolean>=async()=>false;
 const context:any={disposed:false,navigator:{onLine:true},isPosOnlyCloudStagingTarget:()=>false,waitForBackgroundSyncWindow:()=>wait(),lifecycleReasons:new Set(),
  syncMetrics:{increment(){},markPullStarted(){},markPullFinished(){},markSuccessfulSync(){}},triggerErpSyncOutbox:async()=>null,
  usesLargeMasterSyncV3Authority:()=>v3,syncPolicy:{resolve:()=>({kind:'ERP_ACTIVE'})},isV3CatalogHint,
  syncManager:{syncTerminalManifestInBackground:async(_arg:unknown,options:unknown)=>{manifests.push(options);},isUsingConfigPushV2Primary:()=>true,pullCatalog:async(collection:string)=>{legacy.push(collection);}},
  authenticatedActivityTracker:{record(){}},console:{info(){}}};
 const js=ts.transpileModule('const invoke='+callback.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return {manifests,legacy,context,onWait:(run:()=>Promise<boolean>)=>{wait=run;},invoke:new Function(...Object.keys(context),js+';return invoke;')(...Object.values(context))};
}
test('actual App image executor negotiates native product snapshots including existing empty/default contract; legacy products never hydrate',async()=>{
 for(const collections of [['products'],['items'],['articles'],[],['products','customers']]){
  const f=fixture();await f.invoke({reasons:['REALTIME_HINT'],collections,imageOnly:true,domainVersions:{catalog:42}});
  assert.deepEqual(f.manifests,[{reason:'force_sync',throwOnError:true}]);
  assert.deepEqual(f.legacy,collections.includes('customers')?['customers']:[]);
 }
});
test('actual App preserves customer/supplier image hints and non-V3 product image behavior',async()=>{
 for(const collections of [['customers'],['suppliers']]){const f=fixture();await f.invoke({reasons:['REALTIME_HINT'],collections,imageOnly:true,domainVersions:{catalog:42}});assert.deepEqual(f.manifests,[]);assert.deepEqual(f.legacy,collections);}
 const legacy=fixture(false);await legacy.invoke({reasons:['REALTIME_HINT'],collections:['products'],imageOnly:true,domainVersions:{catalog:42}});
 assert.deepEqual(legacy.manifests,[]);assert.deepEqual(legacy.legacy,['products']);
});
test('coordinator coalesces duplicate image bursts before actual App callback; disposal during deferral cannot refresh',async()=>{
 const f=fixture(),coordinator=new SyncTriggerCoordinator({debounceMs:1});coordinator.configure(f.invoke);
 try{await Promise.all(Array.from({length:8},()=>coordinator.request({reason:'REALTIME_HINT',collections:['products'],imageOnly:true,domainVersions:{catalog:42}})));
  assert.equal(f.manifests.length,1);assert.deepEqual(f.legacy,[]);
 }finally{coordinator.clear();}
 const disposed=fixture();disposed.onWait(async()=>{disposed.context.navigator.onLine=false;return true;});
 await disposed.invoke({reasons:['REALTIME_HINT'],collections:['products'],imageOnly:true,domainVersions:{catalog:43}});
 assert.deepEqual(disposed.manifests,[]);assert.deepEqual(disposed.legacy,[]);
});
