import test from 'node:test';
import assert from 'node:assert/strict';
import {formatFiscalNumber} from '../utils/fiscalNumber';
import {snapshotFiscalIssuance,assertFiscalIssuance} from '../utils/fiscalIssuance';
import {nativeFixture,seedNativeFiscal,id} from './articleFormatsNativeFixture';
import {buildSalePostedPayload} from '../services/sync/SalePostedContract';
for(const code of ['B01','B02','B04','B14','B15','E31','E32','E34','E44','E45'] as const) test(`strict new ${code} numbering and overflow`,()=>{
 const electronic=code.startsWith('E'),width=electronic?10:8,max=10**width-1;
 for(const value of [1,1021,99999999,...(electronic?[100000000,9999999999]:[])]) assert.equal(formatFiscalNumber(code,code,value),code+String(value).padStart(width,'0'));
 for(const value of [0,-1,0.5,NaN,Infinity,max+1,Number.MAX_SAFE_INTEGER])assert.throws(()=>formatFiscalNumber(code,code,value));
 assert.throws(()=>formatFiscalNumber(code,'B02X',1));
});
async function electronicNative(){
 const f=await nativeFixture();const seed=seedNativeFiscal(f);
 const range={...seed.range,id:'range-E31',type:'E31',prefix:'E31',endNumber:9999999999};
 const allocation={...seed.allocation,id:'allocation-E31',fiscalRangeId:range.id,ncfType:'E31',prefix:'E31',reservedEnd:range.endNumber};
 const buffer={...seed.buffer,id:'E31',type:'E31',prefix:'E31',fiscalRangeId:range.id,allocationId:allocation.id};
 const config={...seed.config,terminals:seed.config.terminals.map((terminal:any)=>({...terminal,config:{...terminal.config,fiscal:{mode:'ECF',enabled:true,fiscalRanges:[range],fiscalAllocations:[allocation]}}}))};
 const put=(name:string,row:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(name,row.id,JSON.stringify(row),0,'fixture');
 for(const [name,row] of [['config',config],['fiscalRanges',range],['fiscalAllocations',allocation],['localFiscalBuffer',buffer]] as const)put(name,row);
 const raw=(name:string,key:string)=>(f.db.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(name,key) as any).data;
 const input={global:false,fiscal:{terminalId:id(4),type:'E31' as const,ncf:'E310000000001',expectedConfig:raw('config','current'),expectedBuffer:raw('localFiscalBuffer','E31'),expectedAllocation:raw('fiscalAllocations',allocation.id),expectedRange:raw('fiscalRanges',range.id)}};
 return {...f,range,allocation,buffer,config,input,put};
}
test('native E reservation CAS is unique, additive receipt and frozen provenance survives current-range switch',async()=>{
 const f=await electronicNative();try{
  const snapshot=snapshotFiscalIssuance(f.config as any,f.range as any,f.allocation as any,f.buffer as any,f.input.fiscal.ncf);
  const result=await Promise.allSettled([f.adapter.reserveFinancialNumbers(f.input),f.adapter.reserveFinancialNumbers(f.input)]);
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.documents('nativeFiscalReservations').length,1);
  assert.equal(f.documents('localFiscalBuffer').find((row:any)=>row.id==='E31').currentNumber,2);
  f.put('fiscalRanges',{...f.range,id:'new-current',expiryDate:'2098-01-01'});
  const transaction={id:'sale',ncf:f.input.fiscal.ncf,ncfType:'E31',fiscalIssuance:snapshot,date:'2026-10-16T12:00:00-04:00',total:0,items:[],payments:[]} as any;
  assertFiscalIssuance(transaction);const wire=buildSalePostedPayload(transaction) as any;
  assert.equal(wire.summary.fiscal_range_id,f.range.id);assert.equal(wire.summary.fiscal_issuance.expiryDate,'2099-12-31');
  assert.throws(()=>assertFiscalIssuance({...transaction,ncf:'E310000000002'}));
 }finally{f.db.close();}
});
test('native E reservation rolls back receipt and pointer if a write fails',async()=>{
 const f=await electronicNative();try{
  const before=JSON.stringify(f.documents('localFiscalBuffer'));f.fault.failWrite=1;
  await assert.rejects(()=>f.adapter.reserveFinancialNumbers(f.input));
  assert.equal(JSON.stringify(f.documents('localFiscalBuffer')),before);assert.equal(f.documents('nativeFiscalReservations').length,0);
 }finally{f.db.close();}
});
test('new canonical E cannot reuse immutable historical short E identity',async()=>{
 const f=await electronicNative();try{
  const old={id:'historic',ncf:'E3100000001',pendingPayload:'do not change'};f.put('transactionHistory',old);
  await assert.rejects(()=>f.adapter.reserveFinancialNumbers(f.input),/HISTORICAL_COLLISION/);
  assert.deepEqual(f.documents('transactionHistory'),[old]);assert.equal(f.documents('nativeFiscalReservations').length,0);
 }finally{f.db.close();}
});

test('historical E alias guards use expression indexes rather than full history scans',async()=>{
 const f=await electronicNative();try{
  const {planNativeFiscalReceipt}=await import('../services/db/NativeFiscalReservation');
  const statements:string[]=[];
  await planNativeFiscalReceipt(async<T>(sql:string,values:(string|number|null)[])=>{
   if(sql.includes('INDEXED BY idx_documents_fiscal_history_')){
    statements.push(sql);const plan=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...values) as any[];
    assert.ok(plan.some(row=>String(row.detail).includes('USING INDEX idx_documents_fiscal_history_')),JSON.stringify(plan));
   }
   return f.db.prepare(sql).all(...values) as T[];
  },f.config as any,f.buffer as any,f.input.fiscal.ncf,{requireIssuer:false});
  assert.equal(statements.length,5);assert.ok(statements.every(sql=>!sql.includes('CAST')&&!sql.includes('substr')));
 }finally{f.db.close();}
});
