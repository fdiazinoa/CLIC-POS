import test from 'node:test';
import assert from 'node:assert/strict';
import {captureNewV3FiscalSourceMetadata} from '../services/sync/NewV3FiscalSourceMetadata';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function inputs(){const binding=JSON.stringify([id(1),id(4),'device-non-uuid','https://erp.invalid/api/sync','https://catalog.invalid']);const config:any={terminals:[{id:id(4),config:{erpTerminalId:id(4),currentDeviceId:'device-non-uuid',erpBinding:{tenantId:id(1),companyId:id(2),storeId:id(3)}}}]};const tx:any={id:id(90),documentType:'TICKET',settlementCurrencyCode:'DOP',fiscalMode:'ECF',fiscalProvider:'MSELLER',ncfType:'E32',fiscalEnvironment:0,terminalId:id(4),v3Binding:binding,v3WarehouseId:id(5),items:[{v3SaleAuthority:{binding,warehouseId:id(5)}}],fiscalIssuance:{tenantId:id(1),companyId:id(2),terminalId:id(4)}};return{tx,config,binding};}
test('new DOP source captures exact authorized scope plus explicit profile timezone without mutating transaction/config',()=>{
 for(const environment of [0,1,2])for(const type of ['E31','E32','E44','E45']){const {tx,config,binding}=inputs();tx.fiscalEnvironment=environment;tx.ncfType=type;const before=JSON.stringify([tx,config]);assert.deepEqual(captureNewV3FiscalSourceMetadata(tx,config,binding),{tenant_id:id(1),company_id:id(2),store_id:id(3),terminal_id:id(4),device_id:'device-non-uuid',timezone:'America/Santo_Domingo',pos_operational_contract_version:'1'});assert.equal(JSON.stringify([tx,config]),before);}
});
test('new eligible source rejects each binding/config/frozen authority mismatch, no fallback authority',()=>{
 for(const mutate of [(f:any)=>f.config.terminals.push(structuredClone(f.config.terminals[0])),(f:any)=>f.config.terminals=[],(f:any)=>f.config.terminals[0].config.erpBinding.tenantId=id(12),(f:any)=>f.config.terminals[0].config.erpBinding.companyId='missing',(f:any)=>delete f.config.terminals[0].config.erpBinding.storeId,(f:any)=>f.config.terminals[0].config.currentDeviceId='foreign',(f:any)=>f.tx.fiscalIssuance.tenantId=id(12),(f:any)=>f.tx.fiscalIssuance.companyId=id(12),(f:any)=>f.tx.fiscalIssuance.terminalId=id(12),(f:any)=>f.tx.terminalId=id(12),(f:any)=>f.tx.v3Binding='other',(f:any)=>f.tx.items[0].v3SaleAuthority.binding='other',(f:any)=>f.tx.items[0].v3SaleAuthority.warehouseId=id(12),(f:any)=>f.binding='[]']){const f=inputs();mutate(f);assert.throws(()=>captureNewV3FiscalSourceMetadata(f.tx,f.config,f.binding),/FISCAL_V3_NEW_SOURCE_SCOPE_REQUIRED/);}
});
test('Legacy B, No fiscal, other provider, missing environment and retained/returns/closed sources keep serializer extras empty',()=>{
 for(const patch of [{fiscalMode:'NONE'},{fiscalMode:'LEGACY_B',ncfType:'B02'},{fiscalProvider:'DIGIFACT'},{fiscalEnvironment:undefined},{fiscalEnvironment:'0'},{settlementCurrencyCode:'USD'},{documentType:'REFUND'},{ncfType:'E34'},{reservationId:'r'},{v3ReservationClaimId:'r'},{v3RestoredTicketId:'r'},{originalTransactionId:'old'},{restaurantOrderId:'order'},{restaurantTableId:'table'},{uberOrderId:'uber'},{marketplaceOrderId:'market'},{zReportId:'z'},{closedAt:'old'}]){const f=inputs();assert.deepEqual(captureNewV3FiscalSourceMetadata({...f.tx,...patch},f.config,f.binding),{});}
 for(const options of [{refund:true},{retained:true}]){const f=inputs();assert.deepEqual(captureNewV3FiscalSourceMetadata(f.tx,f.config,f.binding,options),{});}
});

test('profile timezone requires explicit consistent original DOP and no transaction/payment FX conflict',()=>{
 for(const patch of [{currency:'USD'},{settlement_currency_code:'USD'},{exchangeRate:2},{settlementExchangeRate:2},{settlement_exchange_rate:'1'},{payments:[{currency:'USD'}]},{payments:[{currencyCode:'USD'}]},{payments:[{currency_code:'USD'}]},{payments:[{currency:'DOP',exchangeRate:2}]},{payments:[{currency:'DOP',exchange_rate:'1'}]},{settlementCurrencyCode:undefined}]){const f=inputs();assert.deepEqual(captureNewV3FiscalSourceMetadata({...f.tx,...patch},f.config,f.binding),{});}
 const f=inputs(),originalDate='2026-10-17T12:00:00.000Z';f.tx.date=originalDate;f.tx.payments=[{currency:'DOP',exchangeRate:1}];f.tx.currency='DOP';const originalTimezone=process.env.TZ;
 try{for(const timezone of ['UTC','Asia/Tokyo']){process.env.TZ=timezone;assert.equal(captureNewV3FiscalSourceMetadata(f.tx,f.config,f.binding).timezone,'America/Santo_Domingo');assert.equal(f.tx.date,originalDate);}}finally{if(originalTimezone===undefined)delete process.env.TZ;else process.env.TZ=originalTimezone;}
});


test('new foreign tender captures configured DOP fiscal base while retaining original currencies and rates',async()=>{
 const {buildTransactionSettlementFields}=await import('../utils/paymentSettlement');
 const f=inputs();f.config.currencies=[{code:'DOP',isBase:true},{code:'USD',isBase:false}];
 Object.assign(f.tx,{currency:'DOP',total:100,...buildTransactionSettlementFields([{id:'cash',method:'CASH',amount:120,currencyCode:'USD',exchangeRate:60,amountOriginal:2} as any],100,'DOP')});
 const original=JSON.stringify(f.tx);assert.equal(captureNewV3FiscalSourceMetadata(f.tx,f.config,f.binding).pos_operational_contract_version,'1');assert.equal(JSON.stringify(f.tx),original);
 f.tx.payments[0].amountOriginal=1;assert.deepEqual(captureNewV3FiscalSourceMetadata(f.tx,f.config,f.binding),{});
});
