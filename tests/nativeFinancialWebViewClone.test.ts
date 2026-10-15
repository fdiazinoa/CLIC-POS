import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeFixture,seedNativeFiscal,id} from './articleFormatsNativeFixture';
import type {FinancialNumberReservation} from '../services/db/DatabaseAdapter';
async function withoutClone<T>(work:()=>Promise<T>):Promise<T>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'structuredClone');
 Object.defineProperty(globalThis,'structuredClone',{value:undefined,configurable:true,writable:true});
 try{return await work();}finally{if(original)Object.defineProperty(globalThis,'structuredClone',original);else delete (globalThis as any).structuredClone;}
}
function fiscal(f:Awaited<ReturnType<typeof nativeFixture>>):FinancialNumberReservation{
 const buffer=f.documents('localFiscalBuffer')[0],raw=(collection:string,key:string)=>(f.db.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(collection,key) as any).data;
 return {seriesId:id(9),documentType:'TICKET',global:true,fiscal:{terminalId:id(4),type:'B02',ncf:'B0200000001',expectedConfig:raw('config','current'),expectedBuffer:raw('localFiscalBuffer',buffer.id),expectedAllocation:raw('fiscalAllocations',buffer.allocationId),expectedRange:raw('fiscalRanges',buffer.fiscalRangeId)}};
}

test('actual native reservation without runtime clone supports frozen input and undefined optional fields',async()=>{
 const f=await nativeFixture();try{
  const input=Object.freeze({seriesId:id(9),documentType:undefined,global:true,fiscal:undefined});
  const result=await withoutClone(()=>f.adapter.reserveFinancialNumbers(input));assert.equal(result.displayId,'TCK-000001');assert.equal(result.globalSequence,1);assert.equal(result.seriesNumber,1);assert.equal(f.documents('internalSequences')[0].nextNumber,2);assert.equal(Object.hasOwn(input,'fiscal'),true);assert.equal(input.global,true);
 }finally{f.db.close();}
});

test('owned prequeue snapshot isolates top-level and fiscal nested caller mutation without runtime clone',async()=>{
 const f=await nativeFixture();try{
  seedNativeFiscal(f);let started!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>started=r),held=new Promise<void>(r=>release=r);
  const owner=f.sql.runExclusive!(async()=>{started();await held;});await entered;
  const input=fiscal(f),originalFiscal={...input.fiscal!};const promise=withoutClone(async()=>{
   const reservation=f.adapter.reserveFinancialNumbers(input);input.seriesId=id(999);input.global=false;input.fiscal!.ncf='B0200000999';input.fiscal!.expectedConfig='{}';input.fiscal!.expectedBuffer='{}';input.fiscal!.expectedAllocation='{}';input.fiscal!.expectedRange='{}';
   release();return reservation;
  });const result=await promise;await owner;
  assert.equal(result.ncf,originalFiscal.ncf);assert.equal(result.displayId,'TCK-000001');assert.equal(result.globalSequence,1);assert.equal(f.documents('nativeFiscalReservations').length,1);assert.equal(f.documents('nativeFiscalReservations')[0].ncf,originalFiscal.ncf);assert.equal(input.fiscal!.ncf,'B0200000999');
 }finally{f.db.close();}
});

test('frozen fiscal snapshot succeeds; wrong CAS rejects with no sequence/receipt mutation',async()=>{
 const f=await nativeFixture();try{
  seedNativeFiscal(f);const bad=fiscal(f);bad.fiscal!.expectedBuffer='{}';const before=f.state();
  await withoutClone(()=>assert.rejects(f.adapter.reserveFinancialNumbers(bad),/AUTHORITY_CONFLICT/));assert.deepEqual(f.state(),before);
  const input=fiscal(f);Object.freeze(input.fiscal);Object.freeze(input);await withoutClone(()=>f.adapter.reserveFinancialNumbers(input));assert.equal(f.documents('nativeFiscalReservations').length,1);
 }finally{f.db.close();}
});

test('snapshot accessor failure occurs before BEGIN and preserves all state',async()=>{
 const f=await nativeFixture();try{
  const before=f.state(),bridge=(f.adapter as any).db,begin=bridge.beginTransaction.bind(bridge);let begins=0;bridge.beginTransaction=async()=>{begins++;return begin();};
  const input={global:true,get fiscal():FinancialNumberReservation['fiscal']{throw Error('invalid-snapshot');}};
  await withoutClone(()=>assert.rejects(f.adapter.reserveFinancialNumbers(input),/invalid-snapshot/));assert.equal(begins,0);assert.deepEqual(f.state(),before);
 }finally{f.db.close();}
});

for(const fault of ['write','precommit','lost-commit'] as const)test(`clone-free reservation ${fault} rolls back or survives full commit/reopen`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-webview-reserve-')),file=join(dir,'pos.sqlite');let f=await nativeFixture(new SQLite(file));try{
  seedNativeFiscal(f);const input=fiscal(f),before=f.state();if(fault==='write')f.fault.failWrite=1;if(fault==='precommit')f.fault.failBeforeCommit=true;if(fault==='lost-commit')f.fault.loseCommitResponse=true;
  await withoutClone(()=>assert.rejects(f.adapter.reserveFinancialNumbers(input),fault==='lost-commit'?/COMMIT_UNCERTAIN/:/injected-/));
  if(fault!=='lost-commit')assert.deepEqual(f.state(),before);else{assert.equal(f.documents('nativeFiscalReservations').length,1);assert.equal(f.documents('internalSequences')[0].nextNumber,2);}
  f.db.close();f=await nativeFixture(new SQLite(file),false);if(fault==='lost-commit'){
   assert.equal(f.documents('nativeFiscalReservations').length,1);assert.equal(f.documents('internalSequences')[0].nextNumber,2);
   await withoutClone(()=>assert.rejects(f.adapter.reserveFinancialNumbers(input),/AUTHORITY_CONFLICT|NUMBER_ALREADY_ISSUED/));assert.equal(f.documents('nativeFiscalReservations').length,1);
  }else assert.deepEqual(f.state(),before);
 }finally{if(f.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});
