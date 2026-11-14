import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeFiscalCreditApplicationStore,FISCAL_CREDIT_APPLICATION_SCHEMA} from '../services/db/NativeFiscalCreditApplicationStore';
import {id} from './articleFormatsNativeFixture';
function store(db:SQLite.Database){
 let queue=Promise.resolve();const lock=<T>(work:()=>Promise<T>):Promise<T>=>{const p=queue.then(work);queue=p.then(()=>undefined,()=>undefined);return p;};
 const sql={query:async(q:string,v:any[]=[])=>({values:db.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>db.prepare(q).run(...v)};
 return new NativeFiscalCreditApplicationStore(()=>sql,lock,work=>lock(async()=>{db.exec('BEGIN IMMEDIATE');try{const result=await work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}));
}
test('closing and reopening native SQLite preserves command bytes, operation and immutable receipt',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'credit-reopen-')),file=join(directory,'fixture.sqlite'),scope={tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50)};
 let db=new SQLite(file);try{db.exec(FISCAL_CREDIT_APPLICATION_SCHEMA);const first=await store(db).begin(scope,id(200),id(201),30,false,'https://erp.invalid');db.close();db=new SQLite(file);
 const reopened=store(db),pending=await reopened.current(scope,id(200),id(201));assert.deepEqual(pending,first);
 const receipt={...JSON.parse(first.commandBytes),currency:'DOP',destination:'INVOICE_DEBT',walletBalance:70,receiptEntryId:id(202),accountingEntryId:id(203)};
 const done=await reopened.complete(pending!,receipt);db.close();db=new SQLite(file);assert.deepEqual((await store(db).begin(scope,id(200),id(201),90)).receipt,receipt);
 await assert.rejects(()=>store(db).complete(done,{...receipt,amount:99}),/IDENTITY_CONFLICT/);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
