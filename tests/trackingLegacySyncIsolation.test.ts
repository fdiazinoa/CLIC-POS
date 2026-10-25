import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../services/sync/BackgroundSyncManager.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('sync.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let method:ts.MethodDeclaration|undefined;
function visit(node:ts.Node){if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='isOperationalSyncPending')method=node;ts.forEachChild(node,visit);}visit(ast);
const actual=new Function('isRecoveredOperation',ts.transpileModule('return function(item,collectionName) '+method!.body!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(()=>false);
test('legacy scanner skips tracking-owned receipts and ledgers while untracked pending work remains eligible',()=>{
 const context={nextRetryDelayMs:null,STUCK_SYNCING_TIMEOUT_MS:1000};
 for(const collection of ['transactions','inventoryLedger']){
  assert.equal(actual.call(context,{syncStatus:'PENDING',trackingCheckoutId:'tracking-operation'},collection),false);
  assert.equal(actual.call(context,{syncStatus:'PENDING'},collection),true);
 }
});
