import type {BusinessConfig,Transaction} from '../../types';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const device=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160&&value.trim()===value&&!/[\r\n\t]/.test(value);
/** New direct fiscal sources only. These are envelope fields at birth, never an authority backfill. */
export function captureNewV3FiscalSourceMetadata(document:Transaction,config:BusinessConfig,binding:string,options:{refund?:boolean;retained?:boolean;offlineTableAccount?:boolean}={}):Record<string,string> {
 const tx=document as Transaction&Record<string,any>;
 const currencies=[tx.currency,tx.settlementCurrencyCode,tx.settlement_currency_code].filter(value=>value!==undefined&&value!==null&&value!=='');
 const paymentCurrencies=(tx.payments||[]).flatMap(payment=>[payment.currency,(payment as any).currencyCode,(payment as any).currency_code]).filter(value=>value!==undefined&&value!==null&&value!=='');
 const rates=[tx.exchangeRate,tx.settlementExchangeRate,tx.settlement_exchange_rate,...(tx.payments||[]).flatMap(payment=>[(payment as any).exchangeRate,(payment as any).exchange_rate])].filter(value=>value!==undefined&&value!==null);
 if(!currencies.length||currencies.some(value=>value!=='DOP')||paymentCurrencies.some(value=>value!=='DOP')||rates.some(value=>value!==1))return {};
 if(options.refund||options.retained&&!options.offlineTableAccount||tx.documentType!=='TICKET'||tx.fiscalMode!=='ECF'||tx.fiscalProvider!=='MSELLER'||!['E31','E32','E44','E45'].includes(tx.ncfType||'')
  ||!Object.prototype.hasOwnProperty.call(tx,'fiscalEnvironment')||typeof tx.fiscalEnvironment!=='number'||![0,1,2].includes(tx.fiscalEnvironment)
  ||[tx.originalTransactionId,tx.reservationId,tx.v3ReservationClaimId,tx.v3RestoredTicketId,...(options.offlineTableAccount?[]:[tx.restaurantOrderId,tx.restaurantTableId]),tx.uberOrderId,tx.marketplaceOrderId,tx.zReportId,tx.closedAt,tx.closingId].some(Boolean))return {};
 const fail=():never=>{throw Error('FISCAL_V3_NEW_SOURCE_SCOPE_REQUIRED');};
 let source:any;try{source=JSON.parse(binding);}catch{fail();}
 if(!Array.isArray(source)||source.length!==5||JSON.stringify(source)!==binding||!uuid(source[0])||!uuid(source[1])||!device(source[2])||source.slice(3).some(value=>typeof value!=='string'||!value))fail();
 const [tenantId,terminalId,deviceId]=source;
 const terminals=(config.terminals||[]).filter(row=>row.id===terminalId||row.config?.erpTerminalId===terminalId);
 if(terminals.length!==1)fail();const terminal=terminals[0],local=terminal.config,erp=local?.erpBinding,fiscal=tx.fiscalIssuance;
 if(tx.terminalId!==terminalId||tx.v3Binding!==binding||!uuid(tx.v3WarehouseId)||!tx.items.length||tx.items.some(line=>line.v3SaleAuthority?.binding!==binding||line.v3SaleAuthority?.warehouseId!==tx.v3WarehouseId)
  ||local?.erpTerminalId&&local.erpTerminalId!==terminalId||local?.currentDeviceId!==deviceId||erp?.tenantId!==tenantId||!uuid(erp?.companyId)||!uuid(erp?.storeId)
  ||!fiscal||fiscal.tenantId!==tenantId||fiscal.companyId!==erp.companyId||fiscal.terminalId!==terminalId)fail();
 return {tenant_id:tenantId,company_id:erp.companyId!,store_id:erp.storeId!,terminal_id:terminalId,device_id:deviceId,timezone:'America/Santo_Domingo'};
}
