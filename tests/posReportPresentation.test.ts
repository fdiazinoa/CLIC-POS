import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { BusinessConfig, CashMovement, Transaction } from '../types';
import { buildPosReportText, buildPosReportTicket, filterPosReportSource, type PosReportKind } from '../utils/posReports';
import { compactReportDateTime, preparePosReportText, reportPrintableText } from '../utils/posReportPresentation';
import { buildEscPosPosReportPayload } from '../services/printer/PosReportEscPos';
import { buildEscPosVoucherPayload } from '../services/printer/EscPosFormatter';
import { posReportHtml, printPosReport } from '../services/printer/PosReportPrinter';

const config = { companyInfo:{name:'Colmado Álvarez'},currencies:[{code:'DOP',isBase:true}],terminals:[{id:'box',config:{terminalName:'Caja 03',hardware:{printerAssignments:{TICKET:'network'}}}}],
 availablePrinters:[{id:'network',name:'Tickera',type:'TICKET',connection:'NETWORK',address:'192.0.2.10',status:'CONNECTED'}],paymentMethods:[],
} as unknown as BusinessConfig;
const filters={start:'2026-11-17',end:'2026-11-17',terminalId:'box',productLimit:10};
const issued=new Date(2026,10,17,16,9,1);
const tx=(overrides:Partial<Transaction>={}):Transaction=>({id:'sale',date:'2026-11-17T16:00:00',terminalId:'box',documentType:'TICKET',status:'COMPLETED',total:58873.60,taxAmount:12878.60,discountAmount:0,currency:'DOP',
 items:[{id:'p',name:'Café especial con nombre considerablemente largo y Unicode 🍋',price:29436.80,quantity:2}],payments:[{method:'CASH',amount:60000,appliedAmount:58873.60,changeAmount:1126.40,currencyCode:'DOP'}],userId:'u',userName:'Cajero con un nombre considerablemente largo Álvarez',...overrides} as Transaction);
const source={transactions:[tx(),tx({id:'usd',currency:'USD',total:100,payments:[{method:'CASH',amount:100,currencyCode:'USD'}]}),tx({id:'credit',documentType:'REFUND',total:-40,taxAmount:-6,items:[{id:'p',name:'Café especial',quantity:-1,price:20}] as Transaction['items'],payments:[],refundReason:'Motivo extenso '+ 'X'.repeat(70),affectedInvoiceNumber:'ORIGEN-'+ '9'.repeat(65)})],
 movements:[{id:'m',timestamp:'2026-11-17T16:05:00',terminalId:'box',type:'OUT',currencyCode:'DOP',amount:100,reason:'Salida de caja por un motivo considerablemente largo',userName:'Álvarez'}] as CashMovement[],reports:[]};
const kinds:PosReportKind[]=['SALES','PAYMENTS','PRODUCTS','CASHIERS','HOURS','ADJUSTMENTS','CASH'];
const amountTokens=(text:string)=>[...text.matchAll(/[A-Z]{3} -?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)].map(match=>match[0]);

const decodeReport=(base64:string)=>{
 const bytes=Buffer.from(base64,'base64');let cuts=0;const rows:string[]=[];let row='';let font=0,size=0,alignment=0;
 for(let i=0;i<bytes.length;){
  const value=bytes[i++];
  if(value===0x1b){
   const command=bytes[i++];
   if(command===0x40){font=0;size=0;alignment=0;continue;}
   assert.ok([0x21,0x4d,0x61,0x45].includes(command),`unexpected ESC command ${command}`);
   const param=bytes[i++];
   if(command===0x21)assert.equal(param,0,'normal font dimensions');
   if(command===0x4d)font=param;
   if(command===0x61)alignment=param;
   if(command===0x45)assert.ok(param===0||param===1);
  }else if(value===0x1d){
   const command=bytes[i++],param=bytes[i++];
   if(command===0x21)size=param;
   else {assert.equal(command,0x56);assert.equal(param,0);cuts++;}
  }else if(value===10){assert.equal(font,0);assert.equal(size,0);assert.equal(alignment,0);assert.ok(row.length<=32,row);rows.push(row);row='';}
  else {assert.ok(value>=32&&value<=126);row+=String.fromCharCode(value);}
 }
 assert.equal(cuts,1);assert.equal(row,'');return {bytes,rows};
};

test('photo amounts stay atomic and metadata uses local 24-hour rows, not locale p.m. fragments',()=>{
 const text=buildPosReportTicket('SALES',{...source,transactions:[tx()]},filters,config,issued);
 assert.match(text,/Ventas tras descuentos:\n +DOP 58873.60/);
 assert.match(text,/Impuestos registrados:\n +DOP 12878.60/);
 assert.match(text,/Emitido: 17\/11\/2026 16:09:01/);
 assert.match(text,/Desde: 17\/11\/2026\nHasta: 17\/11\/2026/);
 assert.equal(compactReportDateTime(issued),'17/11/2026 16:09:01');
 assert.doesNotMatch(text,/p\.\n|\nm\./);
 assert.equal(text.split('\n').filter(row=>row.trim()==='RESUMEN DE VENTAS').length,1);
});

test('multiline company metadata retains the report title, range, full company and monetary body',()=>{
 const custom={...config,companyInfo:{...config.companyInfo,name:'Clic Suite\nSucursal Norte\x1b'}};
 const text=buildPosReportTicket('SALES',source,filters,custom,issued);
 assert.ok(text.includes('Clic Suite Sucursal Norte'));
 assert.equal(text.split('RESUMEN DE VENTAS').length-1,1);
 assert.equal(text.split('Desde:').length-1,1);assert.equal(text.split('Hasta:').length-1,1);
 assert.doesNotMatch(text,/Periodo:/);assert.deepEqual(amountTokens(text),amountTokens(buildPosReportText('SALES',source,filters,custom,issued)));
});

test('free descriptions ending in decimals are not invented currencies, while declared oversized monetary tokens are rejected',()=>{
 const name='NombreDeProductoSinEspaciosDeCuarentaCaracteres 1.00';
 const custom={...config,companyInfo:{...config.companyInfo,name}};
 const data={...source,transactions:[tx({items:[{id:'p',name,quantity:1,price:100}] as Transaction['items']})]};
 for(const kind of ['PRODUCTS','SALES'] as const){
  const text=buildPosReportTicket(kind,data,filters,custom,issued);
  assert.ok(text.replace(/\s/g,'').includes(name.replace(/\s/g,'')));
  assert.ok(text.split('\n').every(line=>line.length<=32));
  assert.equal(preparePosReportText(text),text);
  decodeReport(buildEscPosPosReportPayload(text));
 }
 const code='MONEDACONOCIDAQUEEXCEDELAS32COLUMNAS';
 const declared={...config,currencies:[{code,isBase:true}]} as BusinessConfig;
 assert.throws(()=>buildPosReportTicket('SALES',{...source,transactions:[tx({currency:code})]},filters,declared,issued),/no cabe/);
 const raw=preparePosReportText(name);assert.ok(raw.replace(/\s/g,'').includes(name.replace(/\s/g,'')));
});

test('all seven presentations preserve financial tokens/order and inputs across refunds, currencies and long fields',()=>{
 const before=JSON.stringify(source);
 for(const kind of kinds){
  const raw=buildPosReportText(kind,source,filters,config,issued);
  const text=buildPosReportTicket(kind,source,filters,config,issued);
  assert.deepEqual(amountTokens(text),amountTokens(raw),kind);
  assert.ok(text.split('\n').every(row=>row.length<=32),kind);
  assert.equal(preparePosReportText(text),text,kind);
  assert.equal(reportPrintableText(text),text,kind);
  const decoded=decodeReport(buildEscPosPosReportPayload(text));
  assert.deepEqual(decoded.rows.slice(0,text.split('\n').length),text.split('\n'),kind);
  assert.doesNotMatch(decoded.bytes.toString('latin1'),/INFORMES POS\nCONSULTA/);
 }
 assert.equal(JSON.stringify(source),before);
 const filtered=filterPosReportSource(source,filters,config);assert.ok(filtered.transactions.length>0);
});

test('empty reports, negative amounts and largest safe amounts keep every currency/value together',()=>{
 for(const kind of kinds){const text=buildPosReportTicket(kind,{transactions:[],movements:[],reports:[]},filters,config,issued);assert.match(text,/Sin registros en el periodo/);decodeReport(buildEscPosPosReportPayload(text));}
 for(const value of ['-9007199254740991.00','9007199254740991.00','1.7976931348623157e+308']){
  const text=preparePosReportText('Etiqueta monetaria muy extensa: DOP '+value);
  assert.ok(text.split('\n').some(row=>row.endsWith('DOP '+value)));
  assert.ok(text.split('\n').every(row=>row.length<=32));
 }
});

test('currency tokens and symbols retain their complete codes, including four letters and negative amounts',()=>{
 for(const currency of ['USDT','RD$','USD$','X-A','dolar'])for(const amount of ['58873.60','-58873.60']){
  const text=preparePosReportText(`Ventas tras descuentos: ${currency} ${amount}`,32,[currency]);
  assert.ok(text.split('\n').some(line=>line.trim()===`${currency} ${amount}`),text);
  assert.equal(preparePosReportText(text),text);
  decodeReport(buildEscPosPosReportPayload(text));
 }
 assert.equal(preparePosReportText('Tickets de venta: 1'),'Tickets de venta: 1');
});

test('ASCII sanitization precedes width calculation and preserves intended alignment spaces',()=>{
 const text=preparePosReportText('  Café 🍋\x1bp\t\x00\nLínea larga de descripción: DOP -12345.67\n'+'Ñ'.repeat(70));
 assert.ok(text.startsWith('  Cafe p\n'));
 assert.equal(preparePosReportText(text),text);
 assert.ok(text.split('\n').every(row=>row.length<=32));
 const {bytes}=decodeReport(buildEscPosPosReportPayload(text));
 assert.equal(bytes.includes(Buffer.from([0x1b,0x70])),false);
 assert.ok(bytes.subarray(0,17).equals(Buffer.from([0x1b,0x40,0x1b,0x21,0,0x1b,0x4d,0,0x1d,0x21,0,0x1b,0x61,0,0x1b,0x45,0])));
});

test('HTML contains exactly the prepared thermal body, no second CSS wrap',()=>{
 const text=buildPosReportTicket('PAYMENTS',source,filters,config,issued);
 const html=posReportHtml(text);
 assert.ok(html.includes('<pre>'+text+'</pre>'));
 assert.match(html,/white-space:pre}/);
 assert.doesNotMatch(html,/pre-wrap|overflow-wrap/);
 assert.match(html,/font:9px monospace/);
 assert.match(posReportHtml('<script>&'),/&lt;script&gt;&amp;/);
});

test('generic voucher bytes remain frozen and Z-history bypasses ordinary presentation errors',()=>{
 const payload=buildEscPosVoucherPayload('ACME','COPIA','  ABC\nDOP 1.00',32)!;
 // Frozen against the unchanged shared formatter, not the new dedicated path.
 assert.equal(createHash('sha256').update(Buffer.from(payload,'base64')).digest('hex'),'22eccd324de5d5635f3f8e97b586ada309eb3751d9dbe6519c532df66c7dc661');
 const component=readFileSync(new URL('../components/PosReports.tsx',import.meta.url),'utf8');
 assert.match(component,/if \(kind === 'Z_HISTORY'\) return \{ text: '', error: '' \}/);
 assert.match(component,/catch \(cause\) \{ return \{ text: '', error:/);
 assert.match(component,/!presentation.error/);
 assert.match(component,/ThermalPrinterService.printZReport\(report, \[\], config, \{ terminalId \}\)/);
});

test('real print service/router submits one TICKET job, deduplicates, and does not retry failures or invalid formatting',async()=>{
 const previousWindow=(globalThis as any).window;const calls:any[]=[];let complete!:(value:any)=>void;
 (globalThis as any).window={ClicPOSNativePrinter:{platform:'android',printEscPos:async(payload:any)=>{calls.push(payload);return new Promise(resolve=>{complete=resolve})}}};
 try{
  const text=buildPosReportTicket('SALES',source,filters,config,issued);
  const first=printPosReport(text,config,'box'),duplicate=printPosReport(text,config,'box');
  assert.equal(first,duplicate);await Promise.resolve();await Promise.resolve();
  assert.equal(calls.length,1);assert.equal(calls[0].connection,'NETWORK');assert.equal(calls[0].printerAddress,'192.0.2.10');
  assert.equal(calls[0].role,'TICKET');assert.equal(calls[0].copies,1);assert.equal(calls[0].jobType,'TICKET');
  decodeReport(calls[0].dataBase64);complete({success:true,status:'success'});assert.equal(await first,true);await Promise.resolve();
  (globalThis as any).window.ClicPOSNativePrinter.printEscPos=async(payload:any)=>{calls.push(payload);return {success:false,status:'error',errorCode:'NETWORK_PRINT_ERROR'}};
  assert.equal(await printPosReport(text,config,'failed'),false);assert.equal(calls.length,2);
  assert.equal(await printPosReport('Valor: DOP '+'9'.repeat(40)+'.00',config,'too-wide'),false);assert.equal(calls.length,2,'unprintable atomic amount must not reach a transport');
 }finally{(globalThis as any).window=previousWindow}
});
