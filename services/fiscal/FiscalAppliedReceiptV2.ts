import type {Transaction} from '../../types';
import {financialIdentity,financialOperationIdentity} from '../db/LargeMasterSyncV3FinancialRetention';
import {assertFiscalIssuance} from '../../utils/fiscalIssuance';
import {fiscalStatusSourceChecksum} from './FiscalStatusProof';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import {captureFiscalBoundContext} from './FiscalBoundContext';
import {buildSalePostedSummary} from '../sync/SalePostedContract';
export const APPLIED_PROFILE='POS_V3_DIRECT_STOCK_PER_DOCUMENT_DOP_V1';
export const APPLIED_SOURCE='ERP_POS_APPLIED_RECEIPT_V2';
export const OBSERVATION_ALGORITHM='SHA256_CANONICAL_JSON_APPLIED_OBSERVATION_V2';
const SALE_ALGORITHM='SHA256_CANONICAL_JSON_FISCAL_SOURCE_PROJECTION_V1';
const PAYMENT_ALGORITHM='SHA256_CANONICAL_JSON_PAYMENT_SOURCE_PROJECTION_V1';
export type FiscalOutboxAnchor={event_id:string;event_type:string;aggregate_type:string;aggregate_id:string;schema_version:number;payload_json:string};
export type FiscalAppliedAnchors={sale:FiscalOutboxAnchor;payment:FiscalOutboxAnchor|null};
export type AppliedReceiptV2={schemaVersion:2;source:typeof APPLIED_SOURCE;decision:'READY';code:'FISCAL_APPLIED_RECEIPT_READY';profile:typeof APPLIED_PROFILE;
 scope:Record<'tenantId'|'companyId'|'storeId'|'terminalId'|'deviceId',string>;sourceDocument:{transactionId:string;eventId:string;eventType:'SALE_POSTED';inboxId:string;checksum:string;checksumAlgorithm:typeof SALE_ALGORITHM};
 document:{erpDocumentId:string;ncf:string;ncfType:'E31'|'E32'|'E44'|'E45';sourceSignedTotal:number;currency:'DOP'};fiscalIssuance:NonNullable<Transaction['fiscalIssuance']>;
 issuer:{rnc:string;providerId:'MSELLER';environment:number;credentialCompanyId:string;credentialAccountRnc:string};environmentBasis:'HISTORICAL_SOURCE';historicalEnvironment:number;
 posAuthority:{v3Binding:string;v3WarehouseId:string;v3InventoryBaseline:string;v3CommitFingerprint:string;lines:Array<{itemId:string;cartId:string;v3SaleAuthority:any}>};
 erpApplicationPlan:{schemaVersion:1;source:'ERP_PRE_APPLICATION_PLAN_V1';id:string;digest:string;capturedAt:string;costAndLocationBasis:'ERP_CAPTURED_BEFORE_NEW_APPLICATION';policy:'PER_DOCUMENT'};
 materialization:{profile:typeof APPLIED_PROFILE;lineIds:string[];movementIds:string[];journalEntryIds:string[];journalLineIds:string[];inventoryLocalId:string;warehouseId:string};
 settlement:{mode:'NONE'|'CASH';sourcePayment:null|{eventId:string;eventType:'PAYMENT_POSTED';inboxId:string;checksum:string;checksumAlgorithm:typeof PAYMENT_ALGORITHM};erpReceiptId:string|null;accountingEntryId:string|null;planId:string|null};
 observation:{algorithm:typeof OBSERVATION_ALGORITHM;digest:string};observedAt:string};
export type AppliedReceiptExpectation={schemaVersion:2;source:typeof APPLIED_SOURCE;profile:typeof APPLIED_PROFILE;sourceTransactionId:string;sourceEventId:string;sourceEventType:'SALE_POSTED';sourcePaymentEventId:string|null;sourceChecksum:string;observation:AppliedReceiptV2['observation']};
export type PreparedAppliedReceipt={receipt:AppliedReceiptV2;expectation:AppliedReceiptExpectation;anchors:FiscalAppliedAnchors;originalTransaction:Transaction};
const fail=(code='FISCAL_V3_RECEIPT_UNAVAILABLE'):never=>{throw Error(code);};
const need=(condition:unknown,code?:string)=>{if(!condition)fail(code);};
const object=(v:any)=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
export const canonicalFiscalJson=(v:any):any=>Array.isArray(v)?v.map(canonicalFiscalJson):object(v)?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonicalFiscalJson(v[k])])):v;
const same=(a:any,b:any)=>JSON.stringify(canonicalFiscalJson(a))===JSON.stringify(canonicalFiscalJson(b));
const exact=(v:any,required:string[],optional:string[]=[])=>{need(object(v)&&required.every(k=>Object.hasOwn(v,k)&&v[k]!==undefined)&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)));};
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const bounded=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(v);
const instant=(v:any)=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const empty=(v:any)=>v===undefined||v===null||v===''||v===false||v===0||Array.isArray(v)&&!v.length;
const cents=(v:any)=>{need(typeof v==='number'&&Number.isFinite(v)&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<1e-7);return Math.round(v*100);};
const scopeKeys=['tenantId','companyId','storeId','terminalId','deviceId'] as const;
const stamps=['v3Binding','v3WarehouseId','v3InventoryBaseline','v3CommitFingerprint'] as const;
const issuanceKeys=['schemaVersion','source','ncf','ncfType','sequence','fiscalRangeId','fiscalAllocationId','prefix','rangeStart','rangeEnd','allocationStart','allocationEnd','expiryDate','issuerRnc','tenantId','companyId','terminalId','capturedAt'];
const safeUrl=(value:any,originOnly=false)=>{let u:URL;try{u=new URL(value);}catch{fail('FISCAL_V3_BINDING_MISMATCH');}need(typeof value==='string'&&(u!.protocol==='https:'||u!.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u!.hostname))&&!u!.username&&!u!.password&&!u!.hash&&!u!.search&&(!originOnly||u!.origin===value),'FISCAL_V3_BINDING_MISMATCH');return u!;};
/** Only point reads of original durable events; no drain/repair/lease or local APPLIED interpretation. */
export const FISCAL_OUTBOX_SOURCE_SQL=`SELECT event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json FROM sync_outbox_v2
 WHERE (event_type IN ('SALE_POSTED','PAYMENT_POSTED') AND aggregate_id=?)
 OR (event_type IN ('SALE_POSTED','PAYMENT_POSTED') AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.transaction.id') END=?)
 OR (event_type IN ('SALE_POSTED','PAYMENT_POSTED') AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.summary.transaction_id') END=?) LIMIT 4`;
export const fiscalOutboxSourceParams=(id:string)=>[id,id,id];
const parseAnchor=(row:FiscalOutboxAnchor,id:string,type:string)=>{
 exact(row,['event_id','event_type','aggregate_type','aggregate_id','schema_version','payload_json']);
 need(uuid(row.event_id)&&row.event_type===type&&row.aggregate_type==='TRANSACTION'&&row.aggregate_id===id&&row.schema_version===1&&typeof row.payload_json==='string');
 // Transport safety cap, not an ERP accounting cardinality or authority constraint.
 need(new TextEncoder().encode(row.payload_json).length<=512000,'FISCAL_V3_SOURCE_SIZE_HELD');
 let payload:any;try{payload=JSON.parse(row.payload_json);}catch{fail();}need(object(payload)&&payload.summary?.transaction_id===id);return payload;
};
export function captureFiscalOutboxAnchors(rows:FiscalOutboxAnchor[],id:string):FiscalAppliedAnchors{
 need(Array.isArray(rows)&&rows.length>=1&&rows.length<=2,'FISCAL_V3_SOURCE_AMBIGUOUS');
 const sales=rows.filter(r=>r.event_type==='SALE_POSTED'),payments=rows.filter(r=>r.event_type==='PAYMENT_POSTED');
 need(sales.length===1&&payments.length<=1,'FISCAL_V3_SOURCE_AMBIGUOUS');
 parseAnchor(sales[0],id,'SALE_POSTED');if(payments.length)parseAnchor(payments[0],id,'PAYMENT_POSTED');
 return JSON.parse(JSON.stringify({sale:sales[0],payment:payments[0]||null}));
}
export const paymentSourceChecksum=(p:any)=>sha256Utf8(JSON.stringify(canonicalFiscalJson({summary:p.summary,payments:p.payments,occurred_at:p.occurred_at,paymentIntentIds:p.paymentIntentIds??null})));
export function assertFiscalOriginalMirror(mirror:any,original:Transaction):void{
 need(mirror&&mirror.id===original.id&&!mirror.zReportId&&!mirror.closedAt&&!mirror.closingId&&['COMPLETED','PAID','PENDING'].includes(mirror.status),'FISCAL_APPLIED_ARCHIVED_SOURCE_HELD');
 need(financialIdentity(mirror)===financialIdentity(original)&&stamps.every(k=>mirror[k]===original[k])&&same(mirror.items.map((i:any)=>i.v3SaleAuthority),original.items.map(i=>i.v3SaleAuthority)),'FISCAL_V3_ORIGINAL_REQUEST_MISMATCH');
}
const declarations=(records:any[],keys:string[],expected:any)=>{for(const r of records)for(const k of keys)if(r?.[k]!==undefined&&r[k]!==null&&r[k]!=='')need(r[k]===expected,'FISCAL_APPLIED_SCOPE_MISMATCH');};
/** Validates the narrow ERP profile without pruning a Product or creating missing historical authority. */
export async function validateFiscalOriginal(anchors:FiscalAppliedAnchors,scope:AppliedReceiptV2['scope']){
 exact(anchors,['sale','payment']);const sale=parseAnchor(anchors.sale,anchors.sale.aggregate_id,'SALE_POSTED'),tx=sale.transaction as any,summary=sale.summary;
 need(object(tx)&&bounded(tx.id)&&tx.id===anchors.sale.aggregate_id&&tx.terminalId===scope.terminalId);
 for(const key of scopeKeys){const snake=key.replace(/[A-Z]/g,x=>'_'+x.toLowerCase());declarations([sale,tx,summary],[key,snake],scope[key]);need(sale[key]===scope[key]||sale[snake]===scope[key],'FISCAL_APPLIED_SCOPE_MISMATCH');}
 if(tx.ncfType==='E34'&&tx.total<0)fail('FISCAL_SIGNED_TOTAL_CONTRACT_REQUIRED');
 need(['E31','E32','E44','E45'].includes(tx.ncfType),'FISCAL_V3_DOCUMENT_TYPE_UNSUPPORTED');
 need(tx.fiscalProvider==='MSELLER'&&tx.fiscalMode==='ECF'&&/^E(?:31|32|44|45)\d{10}$/.test(tx.ncf)&&tx.electronicNcf===tx.ncf);
 const snapshot=tx.fiscalIssuance;exact(snapshot,issuanceKeys);assertFiscalIssuance(tx);
 need(snapshot.schemaVersion===1&&snapshot.source==='POS_FISCAL_RESERVATION_V1'&&snapshot.prefix===tx.ncfType&&['sequence','rangeStart','rangeEnd','allocationStart','allocationEnd'].every(k=>Number.isSafeInteger(snapshot[k])&&snapshot[k]>0)&&snapshot.rangeStart<=snapshot.allocationStart&&snapshot.allocationEnd<=snapshot.rangeEnd&&snapshot.allocationStart<=snapshot.allocationEnd);
 need(snapshot.tenantId===scope.tenantId&&snapshot.companyId===scope.companyId&&snapshot.terminalId===scope.terminalId&&/^(?:\d{9}|\d{11})$/.test(snapshot.issuerRnc||'')&&uuid(snapshot.fiscalRangeId)&&uuid(snapshot.fiscalAllocationId),'FISCAL_ORIGINAL_RANGE_AUTHORITY_REQUIRED');
 need(snapshot.expiryDate===null?tx.ncfType==='E32':typeof snapshot.expiryDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(snapshot.expiryDate));need(instant(snapshot.capturedAt));
 need(same(summary.fiscal_issuance,snapshot)&&summary.fiscal_range_id===snapshot.fiscalRangeId&&summary.fiscal_allocation_id===snapshot.fiscalAllocationId);
 const noSecrets=(value:any):void=>{if(Array.isArray(value)){value.forEach(noSecrets);return;}if(object(value))for(const [k,v] of Object.entries(value)){need(!['auth_token','authToken','password','secret','deviceBindingToken','deviceToken','device_token','syncAuthToken','syncToken','sync_token','authorization'].includes(k)||empty(v),'FISCAL_V3_SECRET_IN_SOURCE_HELD');noSecrets(v);}};noSecrets(sale);
 declarations([summary],['ncf'],tx.ncf);declarations([summary],['electronicNcf','electronic_ncf'],tx.electronicNcf);declarations([summary],['ncfType','ncf_type'],tx.ncfType);
 const environments:any[]=[];for(const record of [tx,summary]){
  declarations([record],['fiscalMode','fiscal_mode'],'ECF');declarations([record],['fiscalProvider','fiscal_provider','fiscal_provider_id'],'MSELLER');
  for(const k of ['fiscalEnvironment','fiscal_environment'])if(record[k]!==undefined&&record[k]!==null)environments.push(record[k]);
  for(const k of ['fiscalCompliance','fiscal_compliance'])if(record[k]!==undefined){need(object(record[k]));declarations([record[k]],['provider'],'MSELLER');declarations([record[k]],['mode'],'ECF');if(record[k].environment!==undefined&&record[k].environment!==null)environments.push(record[k].environment);}
 }
 need(environments.length&&environments.every(v=>Number.isInteger(v)&&[0,1,2].includes(v)&&v===environments[0]),'FISCAL_APPLIED_HISTORICAL_ENVIRONMENT_REQUIRED');
 const currencies=[tx.currency,tx.settlementCurrencyCode,tx.settlement_currency_code].filter(v=>!empty(v));need(currencies.length&&currencies.every(v=>v==='DOP'),'FISCAL_V3_ORIGINAL_CURRENCY_REQUIRED');declarations([summary],['currency','currency_code','settlement_currency_code'],'DOP');
 for(const o of [sale,tx,summary]){
  for(const [key,value] of Object.entries(o)){
   if(/archiv|deleted|post.?z/i.test(key))need(empty(value),'FISCAL_APPLIED_ARCHIVED_SOURCE_HELD');
   if(/coupon|loyalty|wallet|consignment|reservation|refund|restaurant|marketplace|tracking|recipe|kit|serviceType|service_type|serviceCharge|service_charge|voluntaryTip|voluntary_tip|salesCommission|sales_commission|dueDate|due_date/i.test(key))need(empty(value),'FISCAL_V3_ADVANCED_CONTRACT_REQUIRED');
  }
  if(o.status!==undefined)need(['COMPLETED','PAID','PENDING'].includes(o.status));
  for(const k of ['customerId','customer_id','customerName','customer_name','customer_code','customerCode','discountAmount','discount_amount','discountValue','discount_value'])need(empty(o[k]),'FISCAL_V3_ADVANCED_CONTRACT_REQUIRED');
  need(!object(o.customer)||!Object.keys(o.customer).length);need(o.internal_non_fiscal!==true&&o.internalNonFiscal!==true);
  for(const k of ['taxBreakdown','tax_breakdown'])need(o[k]==null||Array.isArray(o[k])&&!o[k].length);
  for(const k of ['exchangeRate','settlementExchangeRate','settlement_exchange_rate'])if(o[k]!=null)need(o[k]===1);
 }
 need(empty(tx.customerSnapshot?.name)&&empty(tx.customerSnapshot?.customer_code)&&empty(tx.customerSnapshot?.customerCode));assertFiscalOriginalMirror(tx,tx);
 const total=cents(tx.total);need(total>0&&cents(tx.netAmount)===total&&cents(tx.taxAmount)===0&&cents(summary.total)===total&&cents(summary.net_amount)===total&&cents(summary.tax_amount)===0);
 let binding:any;try{binding=JSON.parse(tx.v3Binding);}catch{fail('FISCAL_V3_BINDING_MISMATCH');}
 need(Array.isArray(binding)&&binding.length===5&&binding[0]===scope.tenantId&&binding[1]===scope.terminalId&&binding[2]===scope.deviceId&&JSON.stringify(binding)===tx.v3Binding,'FISCAL_V3_BINDING_MISMATCH');safeUrl(binding[3]);safeUrl(binding[4],true);
 need(uuid(tx.v3WarehouseId)&&Array.isArray(tx.items)&&tx.items.length>0&&tx.items.length<=100&&Array.isArray(tx.payments));
 const seen=new Set();let sum=0;
 for(const item of tx.items){
  need(uuid(item.id)&&typeof item.cartId==='string'&&item.cartId.length>0&&!seen.has(item.cartId)&&Number.isSafeInteger(item.quantity)&&item.quantity>0&&item.quantity<=100000);seen.add(item.cartId);
  need(item.type==='PRODUCT'&&item.is_active===true&&item.is_sellable===true&&item.isInventoriable===true&&item.taxable===false&&Array.isArray(item.appliedTaxIds)&&!item.appliedTaxIds.length,'FISCAL_V3_ADVANCED_CONTRACT_REQUIRED');
  for(const k of ['variants','attributes','trackingData','recipeDetails','modifiers','selectedModifiers'])need(empty(item[k]));
  for(const [k,v] of Object.entries(item))if(/consignment|reservation|variantId|variantSku|appliedPromotion|articleFormat|discount|serviceCharge|service_charge/i.test(k))need(empty(v));
  const flags=item.operationalFlags||{};need(!flags.isWeighted&&!flags.usesLots&&!flags.usesSerial&&!flags.promptPrice);
  const amount=cents(item.price)*item.quantity;need(cents(item.price)>0&&Number.isSafeInteger(amount));sum+=amount;
  for(const k of ['netAmount','totalAmount'])if(item[k]!==undefined)need(cents(item[k])===amount);for(const k of ['taxAmount','taxRate'])if(item[k]!==undefined)need(item[k]===0);if(item.originalPrice!==undefined)need(item.originalPrice===item.price);
  const stamp=item.v3SaleAuthority;exact(stamp,['syncId','syncVersion','tariffId','taxIncluded','inventoryVersion','inventoryCursor','binding','warehouseId'],['inventorySyncId','inventorySyncVersion']);
  need(bounded(stamp.syncId)&&Number.isSafeInteger(stamp.syncVersion)&&stamp.syncVersion>0&&bounded(stamp.tariffId)&&stamp.taxIncluded===false&&Number.isSafeInteger(stamp.inventoryVersion)&&stamp.inventoryVersion>=0&&typeof stamp.inventoryCursor==='string'&&stamp.inventoryCursor.length<=4096&&stamp.binding===tx.v3Binding&&stamp.warehouseId===tx.v3WarehouseId,'FISCAL_V3_STAMP_INVALID');
  const stock=stamp.inventorySyncId!==undefined||stamp.inventorySyncVersion!==undefined;if(stock)need(bounded(stamp.inventorySyncId)&&Number.isSafeInteger(stamp.inventorySyncVersion)&&stamp.inventorySyncVersion>0,'FISCAL_V3_STOCK_ANCHOR_INVALID');
  need(tx.v3InventoryBaseline===JSON.stringify([tx.v3Binding,stock?stamp.inventorySyncId:stamp.syncId,stock?stamp.inventorySyncVersion:stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor]),'FISCAL_V3_BASELINE_MISMATCH');
  need(typeof item.name==='string'&&item.name.length<=1024&&Array.isArray(item.tariffs)&&item.tariffs.length===1&&item.tariffs[0].tariffId===stamp.tariffId&&item.tariffs[0].price===item.price);
 }
 need(sum===total&&financialOperationIdentity(tx,tx.v3WarehouseId,{})===tx.v3CommitFingerprint,'FISCAL_V3_COMMIT_FINGERPRINT_MISMATCH');
 need(instant(tx.date)&&sale.timezone==='America/Santo_Domingo');declarations([sale,summary],['occurred_at','occurredAt'],tx.date);
 need(!(['E31','E44','E45'].includes(tx.ncfType)||tx.ncfType==='E32'&&total>=25000000)||/^(?:\d{9}|\d{11})$/.test(String(tx.customerSnapshot?.taxId||'').replace(/[\s-]/g,'')),'FISCAL_BUYER_REQUIRED');
 const cash=tx.payments.length>0;need(cash?tx.payments.length===1&&anchors.payment!==null:anchors.payment===null,'FISCAL_V3_PAYMENT_SOURCE_REQUIRED');
 let payment:any=null;if(cash){const p=tx.payments[0];need(p.method==='CASH'&&cents(p.amount)===total);for(const k of ['change','changeAmount','change_amount','changeBase'])need(empty(p[k]));for(const k of ['currency','currencyCode','currency_code'])if(p[k]!==undefined)need(p[k]==='DOP');for(const k of ['exchangeRate','exchange_rate'])if(p[k]!==undefined)need(p[k]===1);for(const k of ['appliedAmount','applied_amount','functionalAmount','functional_amount','amountOriginal','originalAmount'])if(p[k]!==undefined)need(cents(p[k])===total);
  payment=parseAnchor(anchors.payment!,tx.id,'PAYMENT_POSTED');noSecrets(payment);for(const key of scopeKeys){const snake=key.replace(/[A-Z]/g,x=>'_'+x.toLowerCase());declarations([payment,payment.summary],[key,snake],scope[key]);need(payment[key]===scope[key]||payment[snake]===scope[key]);}
  need(same(payment.summary,buildSalePostedSummary(tx))&&same(payment.payments,tx.payments)&&payment.occurred_at===sale.occurred_at&&same(payment.paymentIntentIds??null,sale.paymentIntentIds??null),'FISCAL_V3_PAYMENT_SOURCE_MISMATCH');
 }
 return{transaction:tx as Transaction,environment:environments[0] as number,checksum:await fiscalStatusSourceChecksum(tx),paymentChecksum:payment?await paymentSourceChecksum(payment):null,
  authority:{...Object.fromEntries(stamps.map(k=>[k,tx[k]])),lines:tx.items.map((i:any)=>({itemId:i.id,cartId:i.cartId,v3SaleAuthority:i.v3SaleAuthority}))}};
}
export async function validateAppliedReceiptV2(value:unknown,anchors:FiscalAppliedAnchors,scope:AppliedReceiptV2['scope'],mirror?:Transaction):Promise<PreparedAppliedReceipt>{
 const r=value as AppliedReceiptV2;
 exact(r,['schemaVersion','source','decision','code','profile','scope','sourceDocument','document','fiscalIssuance','issuer','environmentBasis','historicalEnvironment','posAuthority','erpApplicationPlan','materialization','settlement','observation','observedAt']);
 need(r.schemaVersion===2&&r.source===APPLIED_SOURCE&&r.decision==='READY'&&r.code==='FISCAL_APPLIED_RECEIPT_READY'&&r.profile===APPLIED_PROFILE);
 exact(r.scope,[...scopeKeys]);need(scopeKeys.every(k=>r.scope[k]===scope[k])&&scopeKeys.filter(k=>k!=='deviceId').every(k=>uuid(r.scope[k]))&&typeof r.scope.deviceId==='string'&&r.scope.deviceId.length>0);
 const source=await validateFiscalOriginal(anchors,scope),tx=source.transaction;if(mirror)assertFiscalOriginalMirror(mirror,tx);
 exact(r.sourceDocument,['transactionId','eventId','eventType','inboxId','checksum','checksumAlgorithm']);
 need(r.sourceDocument.transactionId===tx.id&&r.sourceDocument.eventId===anchors.sale.event_id&&r.sourceDocument.eventType==='SALE_POSTED'&&uuid(r.sourceDocument.inboxId)&&r.sourceDocument.checksum===source.checksum&&r.sourceDocument.checksumAlgorithm===SALE_ALGORITHM);
 exact(r.document,['erpDocumentId','ncf','ncfType','sourceSignedTotal','currency']);need(uuid(r.document.erpDocumentId)&&r.document.ncf===tx.ncf&&r.document.ncfType===tx.ncfType&&r.document.sourceSignedTotal===tx.total&&r.document.currency==='DOP');
 exact(r.fiscalIssuance,issuanceKeys);need(same(r.fiscalIssuance,tx.fiscalIssuance));
 exact(r.issuer,['rnc','providerId','environment','credentialCompanyId','credentialAccountRnc']);
 need(r.issuer.rnc===tx.fiscalIssuance!.issuerRnc&&r.issuer.providerId==='MSELLER'&&r.issuer.environment===source.environment&&r.issuer.credentialCompanyId===scope.companyId&&r.issuer.credentialAccountRnc===tx.fiscalIssuance!.issuerRnc&&r.environmentBasis==='HISTORICAL_SOURCE'&&r.historicalEnvironment===source.environment);
 exact(r.posAuthority,[...stamps,'lines']);need(same(r.posAuthority,source.authority));
 need(Array.isArray(r.posAuthority.lines)&&r.posAuthority.lines.length===tx.items.length);for(const line of r.posAuthority.lines)exact(line,['itemId','cartId','v3SaleAuthority']);
 exact(r.erpApplicationPlan,['schemaVersion','source','id','digest','capturedAt','costAndLocationBasis','policy']);const plan=r.erpApplicationPlan;
 need(plan.schemaVersion===1&&plan.source==='ERP_PRE_APPLICATION_PLAN_V1'&&uuid(plan.id)&&digest(plan.digest)&&instant(plan.capturedAt)&&plan.costAndLocationBasis==='ERP_CAPTURED_BEFORE_NEW_APPLICATION'&&plan.policy==='PER_DOCUMENT');
 exact(r.materialization,['profile','lineIds','movementIds','journalEntryIds','journalLineIds','inventoryLocalId','warehouseId']);const m=r.materialization;
 need(m.profile===APPLIED_PROFILE&&uuid(m.inventoryLocalId)&&m.warehouseId===tx.v3WarehouseId);
 // 4096 is a local transport memory cap; no invented fixed journal/COGS cardinality.
 for(const list of [m.lineIds,m.movementIds,m.journalEntryIds,m.journalLineIds])need(Array.isArray(list)&&list.length>0&&list.length<=4096&&list.every(uuid)&&new Set(list).size===list.length);
 exact(r.settlement,['mode','sourcePayment','erpReceiptId','accountingEntryId','planId']);const s=r.settlement;
 if(!anchors.payment)need(s.mode==='NONE'&&s.sourcePayment===null&&s.erpReceiptId===null&&s.accountingEntryId===null&&s.planId===null);
 else{need(s.mode==='CASH');exact(s.sourcePayment,['eventId','eventType','inboxId','checksum','checksumAlgorithm']);
  need(s.sourcePayment!.eventId===anchors.payment.event_id&&s.sourcePayment!.eventType==='PAYMENT_POSTED'&&uuid(s.sourcePayment!.inboxId)&&s.sourcePayment!.checksum===source.paymentChecksum&&s.sourcePayment!.checksumAlgorithm===PAYMENT_ALGORITHM&&uuid(s.erpReceiptId)&&uuid(s.accountingEntryId)&&uuid(s.planId));}
 exact(r.observation,['algorithm','digest']);need(r.observation.algorithm===OBSERVATION_ALGORITHM&&digest(r.observation.digest)&&instant(r.observedAt));
 const expectation:AppliedReceiptExpectation={schemaVersion:2,source:APPLIED_SOURCE,profile:APPLIED_PROFILE,sourceTransactionId:tx.id,sourceEventId:anchors.sale.event_id,sourceEventType:'SALE_POSTED',sourcePaymentEventId:anchors.payment?.event_id||null,sourceChecksum:source.checksum,observation:r.observation};
 return JSON.parse(JSON.stringify({receipt:r,expectation,anchors,originalTransaction:tx}));
}
export type AppliedReadinessDependencies={pair:(id:string)=>Promise<{transaction:Transaction|null;history:Transaction|null}>;rows:(id:string)=>Promise<FiscalOutboxAnchor[]>;context:()=>ReturnType<typeof captureFiscalBoundContext>;catalog:()=>Promise<{binding:string}>;fetchImpl:typeof fetch;timeoutMs?:number};
/** Prepared only: never wired into App or the default dispatcher's production HOLD. */
export const createAppliedReceiptReadiness=(deps:AppliedReadinessDependencies)=>(async(mirror:Transaction):Promise<PreparedAppliedReceipt>=>{
 const context=deps.context(),{origin:_origin,...scope}=context.descriptor;
 const pair=await deps.pair(mirror.id);
 need(pair.transaction&&pair.history&&!pair.transaction.zReportId&&!pair.history.zReportId,'FISCAL_APPLIED_ARCHIVED_SOURCE_HELD');
 const anchors=captureFiscalOutboxAnchors(await deps.rows(mirror.id),mirror.id),source=await validateFiscalOriginal(anchors,scope);
 assertFiscalOriginalMirror(mirror,source.transaction);assertFiscalOriginalMirror(pair.transaction,source.transaction);assertFiscalOriginalMirror(pair.history,source.transaction);
 const assertBinding=async()=>{need((await deps.catalog()).binding===source.transaction.v3Binding,'FISCAL_V3_BINDING_MISMATCH');context.assertCurrent();};
 await assertBinding();
 const params=new URLSearchParams({sourceTransactionId:mirror.id,sourceEventId:anchors.sale.event_id,sourceEventType:'SALE_POSTED',sourceChecksum:source.checksum,ncf:source.transaction.ncf!,environment:String(source.environment)});
 if(anchors.payment)params.set('sourcePaymentEventId',anchors.payment.event_id);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),deps.timeoutMs??5000);
 try{context.assertCurrent();
  const response=await deps.fetchImpl(`${context.descriptor.origin}/api/fiscal/v2/documents/applied-receipt?${params}`,{method:'GET',headers:{...context.headers,Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
  context.assertCurrent();need(response.status===200&&response.headers.get('content-type')?.toLowerCase().includes('application/json'));
  const cap=2*1024*1024;need(!response.headers.get('content-length')||Number(response.headers.get('content-length'))<=cap);
  const reader=response.body?.getReader();need(reader);let bytes=0,text='';const decoder=new TextDecoder();
  try{while(true){const part=await reader!.read();if(part.done)break;bytes+=part.value.length;if(bytes>cap){await reader!.cancel();fail();}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader!.releaseLock();}
  const prepared=await validateAppliedReceiptV2(JSON.parse(text),anchors,scope,mirror);
  await assertBinding();return prepared;
 }catch(error){if(error instanceof Error&&/^FISCAL_[A-Z0-9_]+$/.test(error.message))throw error;fail();}finally{clearTimeout(timeout);}
});
export async function validatePreparedAppliedReceipt(value:unknown,scope:AppliedReceiptV2['scope']&{origin?:string},mirror:Transaction):Promise<PreparedAppliedReceipt>{
 exact(value,['receipt','expectation','anchors','originalTransaction']);const p=value as PreparedAppliedReceipt;
 const validated=await validateAppliedReceiptV2(p.receipt,p.anchors,scope,mirror);
 need(same(p.expectation,validated.expectation)&&same(p.originalTransaction,validated.originalTransaction),'FISCAL_V3_APPLIED_EXPECTATION_MISMATCH');return validated;
}
