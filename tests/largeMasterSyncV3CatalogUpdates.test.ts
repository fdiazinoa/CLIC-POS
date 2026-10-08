import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeLargeMasterSyncV3CatalogUpdates } from '../services/sync/LargeMasterSyncV3CatalogUpdates';
import { setLargeMasterSyncV3CriticalOperation, resetLargeMasterSyncV3OperationGateForTests } from '../services/sync/LargeMasterSyncV3OperationGate';
import { createV3CatalogView } from '../services/sync/LargeMasterSyncV3CatalogView';

test('mounted reader notification waits for payment/print and cleanup cancels held refresh', async () => {
  resetLargeMasterSyncV3OperationGateForTests();
  const target = new EventTarget(); let generations = 0;
  const stop = subscribeLargeMasterSyncV3CatalogUpdates(() => generations++, true, target);
  setLargeMasterSyncV3CriticalOperation('PRINT',true);
  target.dispatchEvent(new Event('v3CatalogUpdated'));
  await Promise.resolve(); assert.equal(generations,0);
  setLargeMasterSyncV3CriticalOperation('PRINT',false);
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(generations,1);
  setLargeMasterSyncV3CriticalOperation('PAYMENT',true);
  target.dispatchEvent(new Event('v3CatalogUpdated')); stop();
  setLargeMasterSyncV3CriticalOperation('PAYMENT',false);
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(generations,1);
});

test('administrative refresh cancels outstanding page generation so stale data cannot repaint', async () => {
  const target = new EventTarget(); const view = createV3CatalogView();
  let release!: (value:any)=>void;
  const old = view.load(()=>new Promise(resolve=>{release=resolve;}));
  const stop = subscribeLargeMasterSyncV3CatalogUpdates(()=>view.cancel(),false,target);
  target.dispatchEvent(new Event('v3CatalogUpdated'));
  await view.load(async()=>({rows:[],total:0,filteredTotal:0,nextCursor:null}));
  release({rows:[{id:'old'}],total:1,filteredTotal:1,nextCursor:null}); await old;
  assert.deepEqual(view.getSnapshot().page?.rows,[]); stop();
});
