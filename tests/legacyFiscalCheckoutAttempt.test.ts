import test from 'node:test';
import assert from 'node:assert/strict';
import type {Transaction} from '../types';
import {LegacyFiscalCheckoutAttempt} from '../services/fiscal/LegacyFiscalCheckoutAttempt';
const tx={id:'sale-1',ncf:'B0200000001',date:'2026-11-14T00:00:00Z',seriesNumber:10,payments:[{method:'CASH',amount:100}]} as Transaction;
test('watchdog losing a create response resumes the original pending draft and does not allocate again',async()=>{
 const retained=new LegacyFiscalCheckoutAttempt();let calls=0,resolve!:(tx:Transaction)=>void;
 const pending=retained.create('same-cart-and-payments',()=>{calls++;return new Promise<Transaction>(r=>{resolve=r;});});
 await Promise.resolve();
 const timeout=Promise.reject(new Error('TIMEOUT_CREATE_TRANSACTION'));
 await assert.rejects(Promise.race([pending,timeout]),/TIMEOUT/);
 const retried=retained.create('same-cart-and-payments',()=>{calls++;return Promise.resolve({...tx,id:'wrong'});});
 assert.equal(retried,pending);resolve(tx);assert.equal(await retried,tx);assert.equal(calls,1);
});
test('failed commit preserves the exact draft, NCF, series and payment identity until success',async()=>{
 const retained=new LegacyFiscalCheckoutAttempt();await retained.create('identity',async()=>tx);
 const full={...tx,customerSnapshot:{name:'Captured customer'}};
 retained.retain('identity',full);
 assert.equal(await retained.resume('identity'),full);
 assert.throws(()=>retained.resume('changed-payments'),/LEGACY_FISCAL_RETRY_CHANGED/);
 retained.complete('different');assert.equal(await retained.resume('identity'),full);
 retained.complete('identity');assert.equal(retained.resume('new-sale'),undefined);
});
test('a definite creation error releases only its failed draft, not a commit failure',async()=>{
 const retained=new LegacyFiscalCheckoutAttempt();await assert.rejects(retained.create('identity',async()=>{throw Error('invalid draft');}),/invalid draft/);
 assert.equal(retained.resume('corrected'),undefined);
 assert.equal(await retained.create('corrected',async()=>tx),tx);
});
