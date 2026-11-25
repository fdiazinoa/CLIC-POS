import { readFileSync } from 'node:fs';
import ts from 'typescript';
import test from 'node:test';import assert from 'node:assert/strict';
import {observeFiscalWorkflowCapability,hasFiscalWorkflowCapability,clearFiscalWorkflowCapability} from '../services/fiscal/FiscalWorkflowV2Capability';
import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
// Evaluate the production callback with explicit boundaries. Scenarios only replace
// dependencies they actually exercise; missing dependencies still fail the test.
const checkoutSource = ts.createSourceFile('POSInterface.tsx',
 readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8'),
 ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let checkoutCallback: ts.ArrowFunction | undefined;
function findCheckoutCallback(node: ts.Node) {
 if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
   && node.name.text === 'beforeV3PaymentEffects' && node.initializer && ts.isArrowFunction(node.initializer)) {
  checkoutCallback = node.initializer;
 }
 ts.forEachChild(node, findCheckoutCallback);
}
findCheckoutCallback(checkoutSource);
assert.ok(checkoutCallback, 'The actual prepayment callback must be present in POSInterface');
const checkoutScript = ts.transpileModule('const invoke = ' + checkoutCallback.getText(checkoutSource), {
 compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function invokeCheckout(overrides: Record<string, unknown> = {}) {
 const dependencies = {
  completedReservationForReceipt: async () => null,
  resolveCommittedFiscalReceipt: async () => null,
  resolveCommittedTrackingReceipt: async () => null,
  resolveCommittedDispatchReceipt: async () => null,
  dbAdapter: {},
  dispatchProjection: undefined,
  assertCheckoutFiscalAuthority: async () => {},
  hasV3ReservationCart: false,
  activeV3Reservation: null,
  selectedCustomer: null,
  effectiveSelectedCustomer: null,
  v3Operational: {},
  getDefaultFiscalProvider: () => 'MSELLER',
  config: {},
  activeTerminalConfig: {},
  activeRecoveredReservation: null,
  activeDirectV3TicketId: null,
  activeTable: null,
  processedCart: [{ quantity: 1 }],
  cart: [{ quantity: 1 }],
  currentFiscalCheckoutCartIdentity: () => 'fixture-cart',
  fiscalCheckoutRef: { current: null },
  fiscalCheckoutOperationRef: { current: null },
  trackingCheckoutRef: { current: null },
  dispatchCheckoutRef: { current: null },
  isIntermediateFractionPayment: false,
  setLargeMasterSyncV3CriticalOperation: () => {},
  ...overrides,
 };
 return new Function(...Object.keys(dependencies), checkoutScript + ';return invoke;')(...Object.values(dependencies));
}
const base='https://erp.example.invalid/api/sync',headers={'X-Tenant-Id':'tenant','X-Terminal-Id':'terminal','X-Device-Id':'device','X-Sync-Token':'synthetic'};
test('old/OFF/unknown backend makes no V2 request/store access; explicit bound master capability enables and expires',async()=>{clearFiscalWorkflowCapability();let requests=0,storeReads=0;const client=createFiscalWorkflowV2Client({readAuth:()=>({base,headers,descriptor:{origin:'https://erp.example.invalid',tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'},fingerprint:'auth',assertCurrent(){}}),fetchImpl:async()=>{requests++;throw Error('NO_NETWORK');},store:()=>{storeReads++;throw Error('NO_NATIVE_ACCESS');}} as any);assert.equal(client.enabled(),false);await client.prefetch();await client.runRound();await assert.rejects(client.consult('historical'),/DISABLED/);await assert.rejects(client.correct('historical',{expectedRevision:0,reason:'unchanged',buyer:{},actorId:'actor',pin:'1234'}),/DISABLED/);await assert.rejects(client.reserveCheckout('cart','operation'),/DISABLED/);assert.equal(requests,0);assert.equal(storeReads,0);
 observeFiscalWorkflowCapability(base,headers,'2',1000);assert.equal(hasFiscalWorkflowCapability(base,headers,1001),true);assert.equal(hasFiscalWorkflowCapability(base,{...headers,'X-Sync-Token':'new'},1001),false);assert.equal(hasFiscalWorkflowCapability('https://other.invalid/api/sync',headers,1001),false);assert.equal(hasFiscalWorkflowCapability(base,headers,301001),false);observeFiscalWorkflowCapability(base,headers,null);assert.equal(client.enabled(),false);observeFiscalWorkflowCapability(base,headers,'disabled');assert.equal(client.enabled(),false);
});
test('format wire serializes a real permit DTO without its local pool state',async()=>{const {formatWirePermit}=await import('../services/fiscal/FiscalWorkflowV2FormatRuntime');const p:any={schemaVersion:2,permitId:'permit',transactionId:'transaction',nonce:'nonce',createdAt:'created',expiresAt:'expires',scope:{tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'},issuerRnc:'101010101',environment:0,authorityHash:'hash',operationKind:'SALE',state:'PERMIT'};const wire=formatWirePermit(p);assert.equal('state'in wire,false);assert.equal(p.state,'PERMIT');assert.deepEqual(Object.keys(wire).sort(),['schemaVersion','permitId','transactionId','nonce','createdAt','expiresAt','scope','issuerRnc','environment','authorityHash','operationKind'].sort());});
test('format buffer preparation preserves a live subpool and renews only missing/exhausted pools',async()=>{const {prepareFormatFiscalBuffer}=await import('../services/fiscal/FiscalWorkflowV2FormatPorts');let buffer:any=null,calls=0;const sql:any={query:async()=>buffer?[{data:JSON.stringify(buffer)}]:[]},context:any={scope:{terminalId:'terminal'}};const reserve=async()=>{calls++;buffer={currentNumber:calls,endNumber:calls};return buffer;};await prepareFormatFiscalBuffer(sql,context,'E32',reserve);assert.equal(calls,1);await prepareFormatFiscalBuffer(sql,context,'E32',reserve);assert.equal(calls,1);buffer.currentNumber++;await prepareFormatFiscalBuffer(sql,context,'E32',reserve);assert.equal(calls,2);buffer.currentNumber='bad';await assert.rejects(prepareFormatFiscalBuffer(sql,context,'E32',reserve),/AUTHORITY/);assert.equal(calls,2);buffer=null;await assert.rejects(prepareFormatFiscalBuffer(sql,context,'E34',async()=>null),/ALLOCATION/);});
test('actual checkout callback holds a retained operation across lost capability instead of falling through to legacy', async () => {
 for (const retained of ['ref', 'operation', 'tag', 'none']) {
  let reserves = 0;
  let reconciliationAttempts = 0;
  const ref = { current: retained === 'ref' ? { phase: 'EFFECT_POSSIBLE', transactionId: 'same' } : null };
  const invoke = invokeCheckout({
   fiscalCompliance: { mode: 'ECF' },
   fiscalWorkflowV2Client: {
    enabled: () => false,
    pendingCheckoutInfo: async () => null,
    reserveCheckout: async () => { reserves++; throw Error('FORBIDDEN'); },
    cancelUnreconcilableAttempt: async () => {
     reconciliationAttempts++;
     return { cancelled: false, note: 'revisa el intento pendiente' };
    },
   },
   processedCart: [{ quantity: 1, ...(retained === 'tag' ? { fiscalCheckoutOperationId: 'same-operation' } : {}) }],
   fiscalCheckoutRef: ref,
   fiscalCheckoutOperationRef: { current: retained === 'operation' ? 'same-operation' : null },
  });
  if (retained === 'none') await assert.rejects(invoke(), /No se puede cobrar sin la autorización fiscal/);
  else await assert.rejects(invoke(), /CHECKOUT_RECONCILIATION/);
  assert.equal(reconciliationAttempts, retained === 'none' ? 0 : 1);
  assert.equal(reserves, 0);
  if (retained === 'ref') assert.equal(ref.current?.transactionId, 'same');
 }
});

test('actual prepayment format callback requires a local permit and rejects pool exhaustion before publishing a checkout or reaching payment effects', async () => {
 let reserves = 0;
 let updates = 0;
 const fiscalCheckoutRef = { current: null };
 const invoke = invokeCheckout({
  fiscalCompliance: { mode: 'ECF' },
  fiscalWorkflowV2Client: {
   enabled: () => true,
   pendingCheckoutInfo: async () => null,
   reserveCheckout: async (_cart: string, _op: string, options: unknown) => {
    reserves++;
    assert.deepEqual(options, { requirePermit: true });
    throw Error('FISCAL_WORKFLOW_PERMIT_REQUIRED');
   },
  },
  processedCart: [{ quantity: 1, articleFormat: { id: 'case' } }],
  fiscalCheckoutRef,
  fiscalCheckoutOperationRef: { current: 'same-operation' },
  onUpdateCart: () => { updates++; },
  setLargeMasterSyncV3CriticalOperation: () => assert.fail('Payment effects must remain fenced'),
 });
 await assert.rejects(invoke(), /No hay autorización fiscal disponible/);
 assert.equal(reserves, 1);
 assert.equal(updates, 0);
 assert.equal(fiscalCheckoutRef.current, null);
});

test('capability arrival notifies mounted preparation once per bound authority; refresh does not create a refill loop',async()=>{
 const {subscribeFiscalWorkflowCapability}=await import('../services/fiscal/FiscalWorkflowV2Capability');clearFiscalWorkflowCapability();let notifications=0;
 const unsubscribe=subscribeFiscalWorkflowCapability(()=>{notifications++;});
 observeFiscalWorkflowCapability(base,headers,'2',1000);assert.equal(notifications,1);
 observeFiscalWorkflowCapability(base,headers,'2',2000);assert.equal(notifications,1);
 observeFiscalWorkflowCapability(base,headers,'2',302001);assert.equal(notifications,2);
 observeFiscalWorkflowCapability(base,{...headers,'X-Device-Id':'other'},'2',302002);assert.equal(notifications,3);
 unsubscribe();clearFiscalWorkflowCapability();assert.equal(notifications,3);
});
test('prefetch is singleflight and cannot save stale authority after invalidation',async()=>{
 clearFiscalWorkflowCapability();observeFiscalWorkflowCapability(base,headers,'2');let requests=0,saves=0,release:()=>void=()=>{};
 const pending=new Promise<void>(r=>{release=r;});const store:any={refillOperation:async()=> 'stable-refill',savePermits:async()=>{saves++;}};
 const client=createFiscalWorkflowV2Client({store:()=>store,readAuth:()=>({base,headers,descriptor:{tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'},assertCurrent(){}}),fetchImpl:async()=>{requests++;await pending;return {ok:true,json:async()=>({schemaVersion:2,authorityHash:'a'.repeat(64),permits:[]})} as Response;}} as any);
 const a=client.prefetch(),b=client.prefetch();assert.equal(a,b);await Promise.resolve();client.invalidate();release();await assert.rejects(a,/DISABLED/);assert.equal(requests,1);assert.equal(saves,0);clearFiscalWorkflowCapability();
});
test('ordinary NONE and LEGACY_B retain their local prepayment path without workflow requests', async () => {
 for (const mode of ['NONE', 'LEGACY_B']) {
  let validations = 0;
  let requests = 0;
  const transitions: boolean[] = [];
  const invoke = invokeCheckout({
   v3Operational: { validate: async () => { validations++; } },
   fiscalCompliance: { mode },
   fiscalWorkflowV2Client: {
    enabled: () => false,
    pendingCheckoutInfo: async () => null,
    reserveCheckout: async () => { requests++; throw Error('FORBIDDEN'); },
   },
   getDefaultFiscalProvider: () => 'NONE',
   setLargeMasterSyncV3CriticalOperation: (operation: string, active: boolean) => {
    assert.equal(operation, 'PAYMENT');
    transitions.push(active);
   },
  });
  const fence = await invoke();
  assert.equal(typeof fence, 'function');
  assert.equal(fence.futureCheckout, undefined);
  assert.equal(validations, 1);
  assert.equal(requests, 0);
  assert.deepEqual(transitions, [true]);
  await fence();
  assert.deepEqual(transitions, [true, false]);
 }
});

test('capability is invalidated by device credential rotation even with the same sync token',()=>{
 const original={...headers,'X-Device-Token':'one'},rotated={...headers,'X-Device-Token':'two'};
 observeFiscalWorkflowCapability(base,original,'2');assert.equal(hasFiscalWorkflowCapability(base,original),true);assert.equal(hasFiscalWorkflowCapability(base,rotated),false);clearFiscalWorkflowCapability();
});


test('actual prepayment callback recovers an existing committed receipt before authority checks or new payment effects', async () => {
 const transaction = { id: 'already-committed', payments: [{ id: 'original-payment' }] };
 const receipt = { transaction };
 let bound = 0;
 const invoke = invokeCheckout({
  resolveCommittedFiscalReceipt: async (paymentIds: string[]) => {
   assert.deepEqual(paymentIds, ['original-payment']);
   return receipt;
  },
  bindCommittedFiscalReceipt: (recovered: typeof receipt) => {
   assert.equal(recovered, receipt);
   bound++;
  },
  assertCheckoutFiscalAuthority: async () => { assert.fail('Recovered receipt must not request new authority'); },
  fiscalWorkflowV2Client: { reserveCheckout: async () => { assert.fail('Recovered receipt must not reserve again'); } },
 });
 const fence = await invoke(['original-payment'], ['CARD']);
 assert.equal(fence.completedTransaction, transaction);
 assert.equal(bound, 1);
 fence();
 assert.equal(bound, 1);
});
