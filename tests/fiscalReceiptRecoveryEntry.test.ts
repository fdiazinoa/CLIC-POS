import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
import {assertFiscalWorkflowCheckoutReplay} from '../services/fiscal/FiscalWorkflowCheckoutReplay';
import {fiscalWorkflowScopeKey} from '../services/fiscal/FiscalWorkflowV2Types';
import {yieldInteractionPaint} from '../components/InteractionProgress';
import {tableFiscalSourceDigest} from '../services/fiscal/OfflineFiscalLease';
const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['resolveCommittedFiscalReceipt','bindCommittedFiscalReceipt','authorizeFiscalReceiptRecovery','completeCommittedFiscalReceipt','beforeV3PaymentEffects','assertCheckoutFiscalAuthority','assertNewCheckoutFiscalAuthority','readCheckoutAdmissionIdentity','handlePaymentConfirm','proceedToCheckout','startCheckoutInteraction','requestCheckout'];
const declarations=new Map<string,string>();
function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))declarations.set(node.name.getText(ast),'const '+node.getText(ast)+';');ts.forEachChild(node,visit);}visit(ast);
const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'};
async function world(fault='',stale=false,v1=false){
 const account={id:'account',tableId:'table',items:[{id:'item',quantity:1,price:555}],total:710.4};
 const context={schemaVersion:1,kind:'TABLE_ACCOUNT',accountId:account.id,tableId:account.tableId,sourceSha256:await tableFiscalSourceDigest(JSON.stringify(account))};
 const cart={fiscalSaleContext:context,items:account.items,customerId:null,fiscalType:'E32'};
 const checkout:any={checkoutId:'checkout',operationId:'operation',transactionId:'transaction',scopeKey:fiscalWorkflowScopeKey(scope),cartIdentity:JSON.stringify(cart),phase:'COMMITTED',paymentIds:['cash'],fiscalSaleContext:context,...(v1?{permit:{permitId:'permit',leaseId:'expired-lease',transactionId:'transaction',scope,expiresAt:'2020-01-01'}}:{allocation:{authorizationId:'authority',ncf:'E320000000001'},allocationIssuance:{ncf:'E320000000001'}})};
 const transaction:any={id:'transaction',terminalId:scope.terminalId,customerId:null,ncf:'E320000000001',ncfType:'E32',fiscalWorkflowCheckoutId:'checkout',fiscalSaleContext:context,...(v1?{}:{fiscalAllocationAuthorizationId:'authority',fiscalIssuance:checkout.allocationIssuance}),payments:[{id:'cash',method:'CASH',amount:710.4}],total:710.4};
 const ref:any={current:stale?{...structuredClone(checkout),phase:'EFFECT_POSSIBLE'}:null},contextRef:any={current:stale?context:undefined};
 let ack=0,close=0,newAuthority=0,openGuard=0,supervisor=0,receiptReads=0,receipt:any=null,modal=false,recovery=false;const errors:string[]=[];const parked={current:[account,{id:'unrelated'}]};
 const native:any={readCheckout:async(id:string)=>{receiptReads++;return id===checkout.checkoutId?structuredClone(checkout):null;},checkoutForTable:async(key:string,id:string,table:string)=>{receiptReads++;return fault!=='new'&&key===checkout.scopeKey&&id===account.id&&table===account.tableId?structuredClone(checkout):null;},acknowledgeCheckout:async(id:string)=>{assert.equal(id,checkout.checkoutId);ack++;checkout.phase='ACKNOWLEDGED';}};
 const client=createFiscalWorkflowV2Client({store:()=>native,readOfflineAuthority:async()=>{newAuthority++;throw Error('NEW_AUTHORITY_WITHDRAWN_EXPIRED_EXHAUSTED');},readAuth:()=>{throw Error('NO_ERP');}} as any);
 const immutable=JSON.stringify(transaction);
 if(fault==='uncommitted')checkout.phase='EFFECT_POSSIBLE';
 if(fault==='cart')cart.items=[{...account.items[0],quantity:2}];
 if(fault==='customer')cart.customerId='changed' as any;
 if(fault==='fiscalType')cart.fiscalType='E31';
 if(fault==='checkout'&&ref.current)ref.current.checkoutId='other';
 if(fault==='operation'&&ref.current)ref.current.operationId='other';
 const f:any={checkoutAdmissionRef:{current:null},checkoutProgressRef:{current:{show:()=>{},lock:()=>{},hide:()=>{}}},yieldInteractionPaint:async()=>{},checkoutAdmissionContextRef:{current:{cart:account.items,terminalId:scope.terminalId,mode:'ECF',v3:true,terminal:{}}},fiscalCheckoutRef:ref,offlineTableFiscalContextRef:contextRef,activeTable:{id:fault==='table'?'other':account.tableId,currentOrderId:fault==='account'?'other':account.id},v3Operational:{validate:async()=>{openGuard++;throw Error('SYNC_V3_RETAINED_TICKET_CHANGED');}},fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:client,readFiscalWorkflowLocalScope:()=>fault==='scope'?{...scope,deviceId:'other'}:scope,activeTerminalConfig:{},activeTerminal:{id:scope.terminalId},terminalId:scope.terminalId,
 currentFiscalCheckoutCartIdentity:(ctx=contextRef.current)=>JSON.stringify({...cart,...(ctx?{fiscalSaleContext:ctx}:{})}),assertFiscalWorkflowCheckoutReplay,tableFiscalSourceDigest,
 db:{getDocument:async(name:string,id:string)=>name==='transactions'||name==='transactionHistory'?fault==='missingReceipt'?null:transaction:name==='parkedTickets'?fault==='digest'?{...account,guests:2}:account:null,assertFiscalIssuerAuthority:async()=>{newAuthority++;throw Error('NEW_AUTHORITY_WITHDRAWN_EXPIRED_EXHAUSTED');}},
 isValidCartQuantity:(n:number)=>Number.isFinite(n)&&n!==0,refundAuthorizedBy:null,activePaymentFraction:null,isCurrentPaymentFraction:true,ensureSalesWithOpenZPermission:()=>fault!=='zPermission',canCheckout:fault!=='permission',requestApproval:async()=>{supervisor++;return false;},amountDueNow:710.4,
 cartTotal:710.4,activeTerminalId:scope.terminalId,completedReservationForReceipt:async()=>null,recordCheckoutDiagnostic:()=>{},paymentFinalizationInFlightRef:{current:false},getLatestPosInteraction:()=>null,window:{setTimeout,clearTimeout},console:{warn:()=>{},error:()=>{}},alert:(message:string)=>errors.push(message),
 fiscalCheckoutOperationRef:{current:'operation'},offlineTablePaymentFenceRef:{current:false},parkedTicketsRef:parked,onUpdateParkedTicketsRef:{current:async(rows:any[])=>{assert.deepEqual(rows,[{id:'unrelated'}]);}},onTableOrderClosedRef:{current:async()=>{close++;}},onClearActiveTable:()=>{},onUpdateCart:()=>{},onSelectCustomer:()=>{},
 observeDestinationAttempt:(_trace:any,fn:any)=>fn(),setReturnToTableMapAfterPayment:()=>{},expectInteractionDestination:()=>{},paymentModalTraceRef:{current:null},setShowPaymentModal:(value:boolean)=>{modal=value;},markInteractionStateUpdate:()=>{},markInteractionStage:()=>{},setReceiptOnlyInitialTransaction:(value:any)=>{receipt=value;},setErrorToast:(message:string)=>errors.push(message),
 beginDestinationInteraction:()=>({stages:{}}),checkoutTraceRef:{current:null},canProceedWithOperationalSession:async()=>fault!=='session',validateTerminalDocument:()=>{newAuthority++;return {isValid:fault==='new',error:'NEW_TERMINAL_VALIDATION'};},config:{},isOrderTakerMode:false,isFiscalModeDisabled:false,processedCart:cart.items,cart:cart.items,requiredSaleFiscalType:'E32',
 hasV3ReservationCart:false,activeV3Reservation:null,activeRecoveredReservation:null,isRecoveredUberOrder:false,isMaster:true,activeDirectV3TicketId:null,selectedCustomer:null,
 };
 const body=[...declarations.values()].join('\n')+'\nreturn {request:requestCheckout,proceed:proceedToCheckout,precharge:assertCheckoutFiscalAuthority,before:beforeV3PaymentEffects,confirm:handlePaymentConfirm,recover:completeCommittedFiscalReceipt,resolve:resolveCommittedFiscalReceipt};';
 const js=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;const api=new Function(...Object.keys(f),js)(...Object.values(f));
 return {api,f,native,checkout,transaction,ref,immutable,state:()=>({ack,close,newAuthority,openGuard,supervisor,receiptReads,receipt,modal,errors,recovery}),assertImmutable:()=>assert.equal(JSON.stringify(transaction),immutable)};
}
for(const v1 of [false,true])for(const stale of [false,true])test(`actual COBRAR request/proceed recovers paid ${v1?'V1':'V2'} stale=${stale} without new tender or eligibility`,async()=>{
 const w=await world('',stale,v1);await w.api.precharge();assert.equal((await w.api.resolve()).transaction.id,'transaction');await w.api.request(1,true);const state=w.state();assert.equal(state.ack,1,JSON.stringify(state));assert.equal(state.close,1);assert.equal(state.receipt.id,'transaction');assert.equal(state.modal,true);assert.equal(state.newAuthority,0);assert.equal(state.openGuard,0);assert.deepEqual(state.errors,[]);w.assertImmutable();
});
for(const fault of ['cart','customer','fiscalType','scope','account','table','checkout','operation','missingReceipt','digest','permission','zPermission','session','uncommitted'])test(`actual receipt entry holds ${fault} and cannot inherit advisory enable`,async()=>{
 const w=await world(fault,true);await w.api.request(1,true);const state=w.state();assert.equal(state.ack,0);assert.equal(state.close,0);assert.equal(state.receipt,null);assert.equal(state.modal,false);if(fault==='permission')assert.equal(state.supervisor,1,JSON.stringify(state));w.assertImmutable();
});
test('actual same modal recovery happens before insufficient new-tender preflight and rejects foreign payment',async()=>{
 const w=await world('',true);await assert.rejects(w.api.recover(['different-cash']),/RECONCILIATION/);assert.equal(w.state().ack,0);
 const modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8'),start=modal.indexOf('   const handleFinalize ='),end=modal.indexOf('\n   const ',start+10);let success=false,receipt:any=null;const f:any={finalizationMountedRef:{current:true},finalizationSubmissionRef:{current:false},finalizationProgressRef:{current:null},finalizationContextRef:{current:{}},yieldInteractionPaint:async()=>{},recordCheckoutDiagnostic:()=>{},items:[],total:710.4,payments:[],isFinalizing:false,isProcessingGateway:false,isSuccessScreen:false,recoverCommittedReceipt:w.api.recover,setIsFinalizing:()=>{},setCompletedTransaction:(txn:any)=>{receipt=txn;},setIsSuccessScreen:(value:boolean)=>{success=value;},setSuccessNotice:()=>{},setFinalizeError:(error:string)=>assert.fail(error),canFinalize:false,alert:()=>assert.fail('new tender preflight'),paymentOperationId:undefined};
 const js=ts.transpileModule(modal.slice(start,end)+'\nreturn handleFinalize;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;await new Function(...Object.keys(f),js)(...Object.values(f))();assert.equal(success,true);assert.equal(receipt.id,'transaction');assert.equal(w.state().ack,1);assert.equal(w.state().newAuthority,0);w.assertImmutable();
});
test('actual status allows only proved receipt independently of exhausted issuance, and recomputes on cart/account changes',async()=>{
 const start=source.indexOf('      const checkFiscalStatus = async () => {'),end=source.indexOf('      const refresh=',start);const w=await world();let recovery=false,status:any;const f:any={...w.f,cancelled:false,resolveCommittedFiscalReceipt:w.api.resolve,setFiscalReceiptRecoveryAvailable:(value:boolean)=>{recovery=value;},setStatus:()=>{},setFiscalStatus:(value:any)=>{status=value;},fiscalWorkflowV2Client:{checkoutFiscalStatus:async()=>({remaining:0,total:3})}};
 const js=ts.transpileModule(source.slice(start,end)+'\nreturn checkFiscalStatus;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;await new Function(...Object.keys(f),js)(...Object.values(f))();assert.equal(recovery,true);assert.equal(status.hasNCF,false);assert.equal(status.remaining,0);
 w.f.activeTable.currentOrderId='other-account';await new Function(...Object.keys(f),js)(...Object.values(f))();assert.equal(recovery,false);assert.equal(status.hasNCF,false);assert.equal(w.state().ack,0);
});

test('receipt-only mode initializes the existing success state from original persisted receipt, without running finalization',()=>{
 const modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8'),start=modal.indexOf('   const [isSuccessScreen, setIsSuccessScreen]'),end=modal.indexOf('   const [shouldClearInput',start);
 const js=ts.transpileModule(modal.slice(start,end)+'\nreturn {isSuccessScreen,completedTransaction};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const receipt={id:'original',payments:[{id:'original-cash',method:'CASH',amount:710.4}]};const mode=new Function('receiptOnlyInitialTransaction','useState',js)(receipt,(initial:any)=>[initial,()=>{}]);assert.equal(mode.isSuccessScreen,true);assert.equal(mode.completedTransaction,receipt);
 const ordinary=new Function('receiptOnlyInitialTransaction','useState',js)(undefined,(initial:any)=>[initial,()=>{}]);assert.equal(ordinary.isSuccessScreen,false);assert.equal(ordinary.completedTransaction,null);
});
test('cleanup failure retains original proof and retries cleanup instead of opening a tender form',async()=>{
 const w=await world('',true);let attempts=0;w.f.onUpdateParkedTicketsRef.current=async()=>{attempts++;if(attempts===1)throw Error('LOCAL_CLEANUP_NOT_ACKNOWLEDGED');};await w.api.request(1,true);assert.equal(w.state().ack,0);assert.equal(w.state().modal,false);assert.equal(w.ref.current.checkoutId,'checkout');assert.equal(w.ref.current.phase,'COMMITTED');w.assertImmutable();
 await w.api.request(2,true);assert.equal(w.state().ack,1);assert.equal(w.state().receipt.id,'transaction');assert.equal(w.state().newAuthority,0);assert.equal(w.state().openGuard,0);assert.equal(attempts,2);w.assertImmutable();
});

async function newSaleWorld(){
 const w=await world('new');w.f.db.assertFiscalIssuerAuthority=async()=>{};w.f.fiscalWorkflowV2Client.checkoutFiscalStatus=async()=>({remaining:3,total:3});w.f.v3Operational.validate=async()=>{};return w;
}
test('one admission coordinator performs one original lookup; duplicate COBRAR before first await cannot run again',async()=>{
 const w=await newSaleWorld();await Promise.all([w.api.request(1,true),w.api.request(2,true)]);assert.equal(w.state().receiptReads,1);assert.equal(w.state().modal,true);assert.equal(w.state().ack,0);assert.deepEqual(w.state().errors,[]);w.assertImmutable();
});
test('cancel before the paint boundary performs no lookup, modal admission or financial action',async()=>{
 const w=await newSaleWorld();let cancel:(()=>void)|undefined;w.f.checkoutProgressRef.current.show=(_message:string,onCancel:()=>void)=>{cancel=onCancel;};const admission=w.api.request(1,true);assert.ok(cancel);cancel!();await admission;assert.equal(w.state().receiptReads,0);assert.equal(w.state().modal,false);assert.equal(w.state().ack,0);assert.equal(w.f.checkoutAdmissionRef.current,null);w.assertImmutable();
});
for(const changed of ['cart','customerId','fiscalType','tableId','accountId','user','canCheckout'])test(`context ${changed} changing during native admission await rejects old handler`,async()=>{
 const w=await newSaleWorld();w.f.db.assertFiscalIssuerAuthority=async()=>{w.f.checkoutAdmissionContextRef.current={...w.f.checkoutAdmissionContextRef.current,[changed]:'different'};};await w.api.request(1,true);assert.equal(w.state().receiptReads,1);assert.equal(w.state().modal,false);assert.equal(w.state().ack,0);assert.match(w.state().errors.join(' '),/CONTEXT_CHANGED/);w.assertImmutable();
});
test('external commit after initial negative lookup is freshly recovered on retained validator rejection',async()=>{
 const w=await newSaleWorld();w.f.db.assertFiscalIssuerAuthority=async()=>{w.native.checkoutForTable=async()=>{return structuredClone(w.checkout);};};w.f.v3Operational.validate=async()=>{throw Error('SYNC_V3_RETAINED_TICKET_CHANGED');};await w.api.request(1,true);assert.equal(w.state().ack,1);assert.equal(w.state().receipt.id,'transaction');assert.equal(w.state().modal,true);assert.deepEqual(w.state().errors,[]);w.assertImmutable();
});
test('real rendering boundary waits for two frame callbacks without timers or financial work',async()=>{
 const old=globalThis.requestAnimationFrame,frames:FrameRequestCallback[]=[];let continued=false;
 try{globalThis.requestAnimationFrame=((callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;}) as any;const wait=yieldInteractionPaint().then(()=>{continued=true;});assert.equal(frames.length,1);assert.equal(continued,false);frames.shift()!(1);await Promise.resolve();assert.equal(continued,false);assert.equal(frames.length,1);frames.shift()!(2);await wait;assert.equal(continued,true);}finally{globalThis.requestAnimationFrame=old;}
});
test('finalize synchronous ref prevents a second original-receipt completion before React state commits',async()=>{
 const w=await world('',true),modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8'),start=modal.indexOf('   const handleFinalize ='),end=modal.indexOf('\n   const ',start+10);const f:any={finalizationMountedRef:{current:true},finalizationSubmissionRef:{current:false},finalizationProgressRef:{current:null},finalizationContextRef:{current:{}},yieldInteractionPaint:async()=>{},recordCheckoutDiagnostic:()=>{},items:[],total:710.4,payments:[{id:'cash'}],isFinalizing:false,isProcessingGateway:false,isSuccessScreen:false,recoverCommittedReceipt:w.api.recover,setCompletedTransaction:()=>{},setIsSuccessScreen:()=>{},setSuccessNotice:()=>{},setFinalizeError:(error:string)=>assert.fail(error)};
 const js=ts.transpileModule(modal.slice(start,end)+'\nreturn handleFinalize;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,finalize=new Function(...Object.keys(f),js)(...Object.values(f));await Promise.all([finalize(),finalize()]);assert.equal(w.state().ack,1);assert.equal(w.state().close,1);assert.equal(f.finalizationSubmissionRef.current,false);w.assertImmutable();
});
test('payment context changing while effect fence awaits cannot record cash or confirm',async()=>{
 const modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8'),start=modal.indexOf('   const handleFinalize ='),end=modal.indexOf('\n   const ',start+10);let effects=0,confirmed=0,released=0,error='';const contextRef={current:{paymentId:'cash',user:'original'}};
 const f:any={finalizationMountedRef:{current:true},finalizationSubmissionRef:{current:false},finalizationProgressRef:{current:null},finalizationContextRef:contextRef,yieldInteractionPaint:async()=>{},recordCheckoutDiagnostic:()=>{},items:[],total:710.4,payments:[{id:'cash',method:'CASH'}],isFinalizing:false,isProcessingGateway:false,isSuccessScreen:false,recoverCommittedReceipt:async()=>null,setFinalizeError:(message:string)=>{error=message;},setSuccessNotice:()=>{},setIsFinalizing:()=>{},canFinalize:true,isCreditActionBlocked:false,beginPosInteraction:()=>({stages:{}}),expectInteractionRender:()=>{},markInteractionStateUpdate:()=>{},markInteractionStage:()=>{},canFinalizeWithTypedAmount:false,workflowPaymentFenceRef:{current:null},setGatewayProgress:()=>{},onConfirm:async()=>{confirmed++;},beforePaymentEffects:async()=>{contextRef.current={paymentId:'different',user:'original'};return Object.assign(()=>{released++;},{recordPaymentEffect:async()=>{effects++;}});}};
 const js=ts.transpileModule(modal.slice(start,end)+'\nreturn handleFinalize;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;await new Function(...Object.keys(f),js)(...Object.values(f))();assert.match(error,/CONTEXT_CHANGED/);assert.equal(effects,0);assert.equal(confirmed,0);assert.equal(released,1);assert.equal(f.finalizationSubmissionRef.current,false);
});
