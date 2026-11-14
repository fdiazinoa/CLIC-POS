import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,seedNativeFiscal,id} from './articleFormatsNativeFixture';
import {clearDeferredFiscalReservation} from '../services/fiscal/DeferredFiscalReservation';

async function fixture(t:any,type:'B01'|'B02',mutation:string){
 const f=await nativeFixture(),seed=seedNativeFiscal(f);
 t.after(()=>{clearDeferredFiscalReservation(type+'00000002');f.db.close();});
 const range={...seed.range,type,prefix:type},allocation={...seed.allocation,ncfType:type,prefix:type,nextNumber:2};
 const put=(name:string,value:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(name,value.id,JSON.stringify(value),0,'fixture');
 const config=seed.config;config.terminals[0].config.fiscal={mode:'LEGACY_B',enabled:true,fiscalRanges:[range],fiscalAllocations:[allocation]};
 put('config',config);put('fiscalRanges',range);put('fiscalAllocations',allocation);
 f.db.prepare("DELETE FROM documents WHERE collection_name='localFiscalBuffer'").run();
 const buffer:any={...seed.buffer,id:type,type,prefix:type,currentNumber:2,startNumber:2,endNumber:2};
 if(mutation==='prefix')buffer.prefix=type==='B01'?'B02':'B01';
 if(mutation==='expiry')buffer.expiryDate='2098-12-31';
 if(mutation==='bounds')buffer.endNumber=allocation.reservedEnd+1;
 if(mutation==='terminal')buffer.terminalId=id(90);
 if(mutation==='behind')buffer.currentNumber=1;
 if(mutation!=='missing')put('localFiscalBuffer',buffer);
 const {dbAdapter}=await import('../services/db');const {db}=await import('../utils/db');
 const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;
 const originals=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));
 for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
 t.after(()=>{for(const n of names){if(originals.get(n))(dbAdapter as any)[n]=originals.get(n);else delete (dbAdapter as any)[n];}});
 const reserve=()=>db.reserveFiscalNumber(type,id(4),1,undefined,undefined,undefined,true);
 const before=f.state(),reserved=await reserve();assert.ok(reserved);assert.deepEqual(f.state(),before,'selection is read-only');
 assert.equal(reserved!.ncf,type+'00000002');
 const tx:any={id:id(60),terminalId:id(4),date:new Date().toISOString(),ncf:reserved!.ncf,ncfType:type,fiscalIssuance:reserved!.fiscalIssuance};
 return {...f,tx,reserve,put,allocation};
}
for(const type of ['B01','B02'] as const)for(const mutation of ['missing','equal','prefix','expiry','bounds','terminal','behind'])test(`ordinary deferred ${type}: ${mutation} buffer cannot invalidate selected number at commit`,async t=>{
 const f=await fixture(t,type,mutation);await f.adapter.saveDocument('transactions',f.tx);
 assert.equal(f.documents('transactions').length,1);assert.equal(f.documents('nativeFiscalReservations').length,1);
 assert.equal(f.documents('fiscalAllocations')[0].nextNumber,3);
 const buffer=f.documents('localFiscalBuffer').find(b=>b.terminalId===id(4));assert.equal(buffer.currentNumber,3);assert.equal(buffer.prefix,type);
 await f.adapter.saveDocument('transactions',f.tx);
 assert.equal(f.documents('nativeFiscalReservations').length,1);assert.equal(f.documents('fiscalAllocations')[0].nextNumber,3);
 await assert.rejects(f.adapter.saveDocument('transactions',{...f.tx,id:id(61)}),/ALREADY_ISSUED/);
});
test('ordinary deferred rollback reuses NCF and replay after lost response retains one sale and receipt',async t=>{
 const f=await fixture(t,'B02','prefix'),before=f.state();f.fault.failWrite=1;
 await assert.rejects(f.adapter.saveDocument('transactions',f.tx),/injected-write/);assert.deepEqual(f.state(),before);
 f.fault.failWrite=undefined;assert.equal((await f.reserve())!.ncf,f.tx.ncf);
 // Simulate transport losing only the successful save response. On restart, the
 // selection marker is absent but the persisted receipt still identifies this sale.
 f.fault.loseCommitResponse=true;
 await assert.rejects(f.adapter.saveDocument('transactions',f.tx),/COMMIT_UNCERTAIN/);
 f.fault.loseCommitResponse=false;
 const collections=['transactions','nativeFiscalReservations','fiscalAllocations','localFiscalBuffer'];
 const committed=collections.map(name=>f.documents(name));clearDeferredFiscalReservation(f.tx.ncf);
 await f.adapter.saveDocument('transactions',f.tx);assert.deepEqual(collections.map(name=>f.documents(name)),committed);
});
test('ERP advancement after selection cannot rewind the lot or reuse a stale selected number',async t=>{
 const f=await fixture(t,'B02','prefix');f.put('fiscalAllocations',{...f.allocation,nextNumber:4});const before=f.state();
 await assert.rejects(f.adapter.saveDocument('transactions',f.tx),/AUTHORITY_CONFLICT/);assert.deepEqual(f.state(),before);
});
