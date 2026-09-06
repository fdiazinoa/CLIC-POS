import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CheckoutDiagnosticRecorder, setCheckoutCaptureContext, setCheckoutTrackingEnabled, checkoutDiagnostics } from '../services/CheckoutDiagnostics';
import { diagnosticEvent } from '../services/CheckoutDiagnosticDelivery';
import { trackCheckoutPrint } from '../services/CheckoutPrintTracking';
const recorder=()=>new CheckoutDiagnosticRecorder(async()=>{});
test('missing total stays omitted on wire, zero remains real zero and phases are explicit',()=>{
 const r=recorder();r.record('OUTBOX_RESULT',{status:'APPLIED'});r.record('CART_RENDER',{items:[],total:0});
 const missing=diagnosticEvent(r.snapshot().recent[0],1),zero=diagnosticEvent(r.snapshot().recent[1],2);
 assert.equal(missing.commercial.total,undefined);assert.equal('total' in JSON.parse(JSON.stringify(missing)).commercial,false);
 assert.match(missing.message,/No registrado/);assert.equal(zero.commercial.total,0);assert.equal(zero.details.total_recorded,true);
 for(const stage of ['PAYMENT_MODAL_CONFIRM','CHECKOUT_CONFIRM','FINANCIAL_COMMIT_OK','PAYMENT_RESULT'])r.record(stage,{status:'RETURNED'});
 const events=r.snapshot().recent.slice(2).map((v,i)=>diagnosticEvent(v,i+3));
 assert.equal(events[0].stage,'CHECKOUT_OPENED');assert.equal(events[1].stage,'CHECKOUT_OPENED');assert.equal(events[2].stage,'TRANSACTION_PERSISTED');assert.equal(events[3].stage,'PAYMENT_CONFIRMED');
 assert.equal(new Set(events.map(e=>e.message)).size,4);
});
test('records mode and actual runtime APK per event without rewriting original session',()=>{
 const r=recorder();const old={id:'session',startedAt:'2026-09-05',expiresAt:'2026-09-06',versionName:'1.1.294',versionCode:1294,terminalId:'terminal',deviceId:'device'};r.setSession(old);
 setCheckoutCaptureContext({mode:'RETAIL',versionName:'1.1.296',versionCode:1296});r.record('CHECKOUT_OPEN',{items:[]});
 setCheckoutCaptureContext({mode:'RESTAURANT'});r.record('CHECKOUT_OPEN',{items:[],tableId:'table'});
 const events=r.snapshot().recent.map((v,i)=>diagnosticEvent(v,i));assert.equal(events[0].details.operating_mode,'RETAIL');assert.equal(events[1].details.operating_mode,'RESTAURANT');assert.equal(events[0].details.captured_apk_version,'1.1.296');assert.equal(r.snapshot().recent[0].session?.versionName,'1.1.294');
});
test('print observation preserves exact promises, rejection and documents both restaurant outputs',async()=>{
 setCheckoutTrackingEnabled(true);
 const p=Promise.resolve(true);assert.equal(trackCheckoutPrint({reason:'TICKET'},()=>p),p);await p;
 const failure=Promise.reject(Error('printer disconnected'));assert.equal(trackCheckoutPrint({reason:'PRECUENTA'},()=>failure),failure);await assert.rejects(failure);
 assert.throws(()=>trackCheckoutPrint({reason:'COMANDA'},()=>{throw Error('sync failure')}),/sync failure/);
 const events=checkoutDiagnostics.snapshot().recent;assert.ok(events.some(e=>e.stage==='PRINT_RESULT'&&e.data.status==='ACCEPTED_BY_PRINT_PIPELINE'));assert.ok(events.some(e=>e.data.reason==='PRECUENTA'&&e.data.status==='ERROR'));assert.ok(events.some(e=>e.data.reason==='COMANDA'&&e.data.status==='ERROR'));
 setCheckoutTrackingEnabled(false);
 const source=readFileSync(new URL('../utils/printer.ts',import.meta.url),'utf8');for(const reason of ['TICKET','PRECUENTA','COMANDA'])assert.ok(source.includes(`reason:'${reason}'`));
 const modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');assert.ok(modal.includes('PRINT_DELIVERY_PLAN'));assert.ok(modal.includes('MANUAL_PRINT_BUTTON'));assert.ok(modal.includes('EMAIL_ONLY'));assert.ok(modal.includes('AUTO_GATEWAY_PRINT'));
});
