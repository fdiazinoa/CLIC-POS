// Executes captured pure transformers and selection excerpts only, in VM with allowlisted imports.
// No App component, DB, HTTP, journal, printers, providers or persistence is loaded.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'source-bundle.json')));
const plain=x=>JSON.parse(JSON.stringify(x));
const cache=new Map();
class FixedDate extends Date{constructor(...x){super(...(x.length?x:['2026-09-06T12:00:00.000Z']));}static now(){return 1788696000000;}}
function load(p){assert(bundle.modules[p],`Disallowed import ${p}`);if(cache.has(p))return cache.get(p).exports;const m={exports:{}};cache.set(p,m);const src=bundle.modules[p];assert.equal(crypto.createHash('sha256').update(src.source).digest('hex'),src.sha256);vm.runInNewContext('(function(require,module,exports){'+src.compiled+'\n})',{Date:FixedDate})(name=>load(path.posix.normalize(path.posix.join(path.posix.dirname(p),name+'.ts'))),m,m.exports);return m.exports;}
const normal=load('services/sync/sourceIdentity.ts'),erp=load('services/sync/erpOutboundPayloads.ts'),settle=load('utils/paymentSettlement.ts'),summary=load('utils/zReportPaymentSummary.ts');
const tx=p=>({id:'SALE-1',terminalId:'T1',device_id:'DEVICE-SYNTHETIC',date:'2026-09-05T23:59:00.000Z',status:'COMPLETED',documentType:'TICKET',total:100,items:[{id:'PRODUCT-1',cartId:'LINE-1',quantity:1,price:100,images:['synthetic-image'],attributes:{color:'blue'},tariffId:'not-a-uuid'}],payments:[{id:'PAY-1',method:'CASH',amount:100,currencyCode:'DOP',timestamp:'2026-09-05T23:59:00.000Z',privateExtra:{synthetic:true},...p}]});
const rows=[];
function differences(a,b,p='$',out=[]){if(JSON.stringify(a)===JSON.stringify(b))return out;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[k],b[k],p+'.'+k,out);}else out.push({path:p,beforePresent:a!==undefined,afterPresent:b!==undefined,...(a!==undefined?{before:a}:{}),...(b!==undefined?{after:b}:{})});return out;}
for(const [id,p] of [['aliases-disagree',{appliedAmount:70,applied_amount:60,amountApplied:50,changeAmount:30,change_amount:40}],['aliases-null',{appliedAmount:null,applied_amount:null,amountApplied:0}],['aliases-invalid',{appliedAmount:'bad',applied_amount:'bad'}],['missing-id-time',{id:undefined,timestamp:undefined}],['gateway',{gatewayStatus:' OK ',gatewayAuthorizationCode:42,gatewayRaw:{synthetic:true}}]]){
 const local=tx(p),before=JSON.stringify(local),n=plain(normal.normalizeTransactionForSync(local)),sent=plain(erp.buildErpSalePayload(local));assert.equal(JSON.stringify(local),before);
 const observed={id,local:plain(local),normalized:n,salePayload:sent,changes:differences(plain(local),sent),appliedLocal:settle.getPaymentAppliedBaseAmount(local.payments[0]),appliedAfterNormalization:settle.getPaymentAppliedBaseAmount(n.payments[0])};rows.push(observed);
 assert(!('privateExtra' in sent.payments[0]));assert(!('images' in sent.items[0]));assert(!('tariffId' in sent.items[0]));
}
assert.equal(rows[0].appliedLocal,70);assert.equal(rows[0].appliedAfterNormalization,60);
assert.equal(rows[1].appliedLocal,0);assert.equal(rows[1].appliedAfterNormalization,0);
assert.equal(rows[2].appliedLocal,0);assert.equal(rows[2].appliedAfterNormalization,100);
assert.equal(rows[3].normalized.payments[0].id,'SALE-1-payment');assert.equal(rows[3].normalized.payments[0].timestamp,'2026-09-06T12:00:00.000Z');
const refund={...tx({}),documentType:'REFUND',originalTransactionId:'OLD-1',ncfType:'B04',ncf:'SYNTHETIC',fiscalMode:'NONE'};
const credit=plain(erp.buildErpCreditNotePayload(refund));assert(!('ncf' in credit));assert.equal(credit.fiscalProvider,'NONE');rows.push({id:'refund-fiscal-none',local:refund,creditPayload:credit,changes:differences(refund,credit)});
const boundaries=[0,0.004,0.005,1.005,-0.005,-1.005,'bad',null].map(value=>({value,applied:settle.getPaymentAppliedBaseAmount({amount:99,appliedAmount:value})}));
assert.deepEqual(boundaries.map(r=>r.applied),[0,0,0.01,1.01,-0,-1,0,99]);
const docs=values=>values.map(amount=>tx({amount,appliedAmount:amount}));
const step=plain(summary.buildZReportPaymentMethodSummary(docs([0.004,0.004]),{})),once=plain(summary.buildZReportPaymentMethodSummary(docs([0.008]),{}));assert.deepEqual(step,[]);assert.equal(once[0].amount,0.01);
const refundSummary=plain(summary.buildZReportPaymentMethodSummary([{...tx({}),documentType:'REFUND'}],{}));assert.equal(refundSummary[0].amount,-100);
const voidSummary=plain(summary.buildZReportPaymentMethodSummary([{...tx({}),documentType:'VOID'}],{}));assert.deepEqual(voidSummary,[]);
const methodPayment={method:'CARD',methodId:'x',methodLabel:'card'};
const configs=[{paymentMethods:[{id:'x',name:'FIRST',type:'CARD'},{id:'X',name:'SECOND',type:'CARD'}]},{paymentMethods:[{id:'X',name:'SECOND',type:'CARD'},{id:'x',name:'FIRST',type:'CARD'}]}];
const names=configs.map(c=>summary.resolveZReportPaymentMethodName(methodPayment,c));assert.deepEqual(names,['FIRST','SECOND']);
function select(source){const ctx={...source,result:null,belongsToCurrentTerminal:(id)=>id==='T1',replacementReportId:'',reportTransactionIds:new Set(['A','B','MISSING']),reportMovementIds:new Set(['M1','M2']),reportCollectionIds:new Set(['C1','C2']),pendingTransactions:[],pendingCashMovements:[]};vm.runInNewContext(bundle.fragments.selection.compiled,ctx);return plain(ctx.result);}
const sameDate='2026-09-05T23:59:00.000Z',a={id:'A',terminalId:'T1',date:sameDate,revision:'1'},b={id:'B',terminalId:'T1',date:sameDate,revision:'2'};
const selection=select({transactionSource:[b,a],cashMovements:[{id:'M2',terminalId:'T1'},{id:'M1',terminalId:'T1'}],collections:[{id:'C2',terminalId:'T1'},{id:'C1',terminalId:'T1'}]});
assert.deepEqual(selection.terminalTransactions.map(x=>x.id),['B','A']);assert.deepEqual(selection.terminalCashMovements.map(x=>x.id),['M2','M1']);assert.deepEqual(selection.terminalCollections.map(x=>x.id),['C2','C1']);
const duplicate=select({transactionSource:[a,{...a,revision:'2'}],cashMovements:[],collections:[]});assert.equal(duplicate.terminalTransactions.length,2);
const pc={config:{terminals:[]},zReports:[{terminalId:'T1',closedAt:'2026-09-06T00:10:00.000Z'}],transactions:[{...a,date:'2026-09-06T00:05:00.000Z'},{...b,date:'2026-09-06T00:05:00.001Z'}],cashMovements:[],result:null};vm.runInNewContext(bundle.fragments.pending.compiled,pc);const pending=plain(pc.result.getPendingTransactionsForTerminal('T1'));assert.deepEqual(pending.map(x=>x.id),['B']);
const output=plain({sourceCommit:bundle.sourceCommit,legacy:'UNKNOWN',exactZEligible:false,closeAuthorization:'NOT_GRANTED',pairs:rows,precision:{boundaries,negativeZeroBoundary:Object.is(boundaries[4].applied,-0),accumulation:{step,once},refundSummary,voidSummary},resolver:{configs,names},selection:{requested:['A','B','MISSING'],found:selection,missing:['MISSING'],duplicateRevisions:duplicate,pendingBoundary:pending},limitations:['Pure captured modules only, synthetic data; not HTTP payload bytes at final transport or ERP persistence.','Selection uses an explicit T1 predicate for the IDs branch, not an authentication/isolation test.','Complete Z construction/persistence and renderer not executed; no recovery authorization.']});
if(process.argv.includes('--record'))fs.writeFileSync(path.join(__dirname,'native-results.json'),JSON.stringify(output,null,2)+'\n');else assert.deepEqual(output,JSON.parse(fs.readFileSync(path.join(__dirname,'native-results.json'))));
console.log('PASS: native pure aliases/coercions/rounding/accumulation/resolvers and selection diagnostics; no operational execution.');
