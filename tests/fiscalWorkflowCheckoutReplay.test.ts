import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {assertFiscalWorkflowCheckoutReplay,readFiscalWorkflowLocalScope} from '../services/fiscal/FiscalWorkflowCheckoutReplay';
import {fiscalWorkflowScopeKey} from '../services/fiscal/FiscalWorkflowV2Types';
const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'};
const cart={items:[{id:'item',quantity:1,price:100}],customerId:'customer',fiscalType:'E32'},cartIdentity=JSON.stringify(cart);
const source:any={id:'original',terminalId:'terminal',customerId:'customer',ncf:'E320000000001',ncfType:'E32',fiscalWorkflowCheckoutId:'checkout'};
const checkout:any={checkoutId:'checkout',transactionId:'original',scopeKey:fiscalWorkflowScopeKey(scope),cartIdentity,phase:'COMMITTED',permit:{transactionId:'original',scope},paymentIds:[]};
test('identity-only replay accepts same original with expired session and pairing dates without granting new authority',()=>{
 const credentials:any={...scope,authStatus:'NEEDS_REAUTH',syncTokenExpiresAt:'2020-01-01',deviceTokenExpiresAt:'2020-01-01'};
 const local=readFiscalWorkflowLocalScope({erpBinding:scope,erpTerminalId:'terminal',currentDeviceId:'device'} as any,'terminal',()=>credentials,()=> 'device');
 assert.deepEqual(local,scope);assert.doesNotThrow(()=>assertFiscalWorkflowCheckoutReplay(checkout,source,cartIdentity,local));
});
for(const field of ['tenantId','companyId','storeId','terminalId','deviceId'])test(`committed replay holds changed ${field}`,()=>{assert.throws(()=>assertFiscalWorkflowCheckoutReplay(checkout,source,cartIdentity,{...scope,[field]:'changed'}),/RECONCILIATION/);});
for(const change of [{...cart,items:[{...cart.items[0],quantity:2}]},{...cart,customerId:'other'},{...cart,fiscalType:'E31'}])test(`committed replay holds changed cart/customer/type ${JSON.stringify(change)}`,()=>{assert.throws(()=>assertFiscalWorkflowCheckoutReplay(checkout,source,JSON.stringify(change),scope),/RECONCILIATION/);});
test('local identity refuses a moved terminal or changed actual device despite retained configuration',()=>{
 for(const credentials of [{...scope,terminalId:'other'},{...scope,deviceId:'other'}])assert.throws(()=>readFiscalWorkflowLocalScope({erpBinding:scope,erpTerminalId:'terminal',currentDeviceId:'device'} as any,'terminal',()=>credentials,()=> 'device'),/RECONCILIATION/);
});
test('actual prepayment callback applies same-scope/cart validation before returning committed source',async()=>{
 const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:any;function visit(n:any){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='beforeV3PaymentEffects')arrow=n.initializer;ts.forEachChild(n,visit);}visit(ast);
 for(const foreign of [false,true]){let authorityCalls=0;const f:any={completedReservationForReceipt:async()=>null,fiscalCheckoutRef:{current:checkout},db:{getDocument:async()=>source},currentFiscalCheckoutCartIdentity:()=>cartIdentity,readFiscalWorkflowLocalScope:()=>foreign?{...scope,deviceId:'other'}:scope,assertFiscalWorkflowCheckoutReplay,activeTerminalConfig:{},terminalId:'terminal',assertCheckoutFiscalAuthority:async()=>{authorityCalls++;throw Error('NO_NEW_AUTH');}};
 const js=ts.transpileModule('const invoke='+arrow.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,invoke=new Function(...Object.keys(f),js+';return invoke;')(...Object.values(f));if(foreign)await assert.rejects(invoke(),/RECONCILIATION/);else assert.equal((await invoke()).completedTransaction,source);assert.equal(authorityCalls,0);}
});

test('actual completion replay validates ownership before ACK or clearing the cart',async()=>{
 const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),start=text.indexOf("         if(fiscalCheckoutRef.current&&['COMMITTED','ACKNOWLEDGED'].includes",text.indexOf('   const handlePaymentConfirm =')),end=text.indexOf('         if(processedCart.some(line=>line.articleFormat))',start),block=text.slice(start,end);
 for(const foreign of [false,true]){let ack=0,cleared=0;const ref={current:checkout},f:any={fiscalCheckoutRef:ref,db:{getDocument:async()=>source},assertFiscalWorkflowCheckoutReplay,currentFiscalCheckoutCartIdentity:()=>foreign?JSON.stringify({...cart,customerId:'other'}):cartIdentity,readFiscalWorkflowLocalScope:()=>scope,activeTerminalConfig:{},activeTerminal:{id:'terminal'},terminalId:'terminal',fiscalWorkflowV2Client:{acknowledge:async()=>{ack++;}},onUpdateCart:()=>{cleared++;},onSelectCustomer:()=>{cleared++;}};
 const js=ts.transpileModule('const invoke=async()=>{'+block+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,invoke=new Function(...Object.keys(f),js+'return invoke;')(...Object.values(f));if(foreign){await assert.rejects(invoke(),/RECONCILIATION/);assert.equal(ref.current,checkout);assert.equal(ack,0);assert.equal(cleared,0);}else{assert.equal(await invoke(),source);assert.equal(ack,1);assert.equal(cleared,2);assert.equal(ref.current,null);}}
});
