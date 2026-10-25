import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {normalizeTransactionForSync} from '../services/sync/sourceIdentity';
const source=readFileSync(new URL('../services/transactionService.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('transactionService.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let method:ts.MethodDeclaration;function visit(node:ts.Node){if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='createTransaction')method=node;ts.forEachChild(node,visit);}visit(ast);
const ports={recordCheckoutDiagnostic:()=>{},assertFormatsPostingClosed:()=>{},isV3FinancialDocument:()=>true,db:{assertFiscalTransactionAuthority:async()=>{},getDocument:async()=>({id:'current'})},getLargeMasterSyncV3OperationalSession:async()=>({projectConfig:async(c:any)=>c,validate:async()=>null}),validateV3FrozenFiscalAmounts:()=>{},validateV3FrozenLineFiscalAmounts:()=>{},normalizeFiscalAmounts:async(data:any)=>({netAmount:data.netAmount,taxAmount:data.taxAmount}),normalizeTransactionForSync,freezeNewV3PaymentTimestamps:(tx:any)=>tx,isSyncFeatureEnabled:()=>false};
const create=new Function(...Object.keys(ports),ts.transpileModule('return async function(data,options={})'+method!.body!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(ports));
for(const fiscal of [false,true])test(`actual normal constructor preserves tracking source before persistence; fiscal=${fiscal}`,async()=>{
 const checkoutId=randomUUID(),effectAt=new Date().toISOString(),data={id:randomUUID(),documentType:'TICKET',seriesId:'series',terminalId:'terminal',items:[{id:'item',cartId:'cart',quantity:.125,price:100,trackingData:[{quantityMinor:125000}],v3SaleAuthority:{tariffId:'tariff',warehouseId:'warehouse'}}],netAmount:12.5,taxAmount:0,total:12.5,payments:[],trackingCheckoutId:checkoutId,trackingEffectAt:effectAt,...(fiscal?{fiscalWorkflowCheckoutId:randomUUID(),fiscalMode:'ECF',fiscalProvider:'MSELLER',fiscalEnvironment:0}:{fiscalMode:'NONE'})};
 const receiver={resolveSeriesIdForEmission:async()=> 'series',generateTransactionId:async()=>({globalSequence:1,displayId:'T1',seriesNumber:1})};
 const transaction=await create.call(receiver,data,{deferDurablePersistence:true});assert.equal(transaction.trackingCheckoutId,checkoutId);assert.equal(transaction.trackingEffectAt,effectAt);assert.deepEqual(transaction.items[0].trackingData,data.items[0].trackingData);
 await assert.rejects(create.call(receiver,{...data,trackingEffectAt:undefined},{deferDurablePersistence:true}),/TRACKING_CHECKOUT_SOURCE_REQUIRED/);
 await assert.rejects(create.call(receiver,{...data,trackingCheckoutId:'wrong'},{deferDurablePersistence:true}),/TRACKING_CHECKOUT_SOURCE_REQUIRED/);
});
