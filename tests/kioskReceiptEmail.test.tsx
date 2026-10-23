import assert from 'node:assert/strict';
import test from 'node:test';
import { fiscalStatusSourceChecksum } from '../services/fiscal/FiscalStatusProof';
import React from 'react';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sale = {
  id: 'uuid-local-committed', displayId: 'CAJA6-123', date: '2026-10-23T16:00:00.000Z',
  total: 118, netAmount: 100, taxAmount: 18, discountAmount: 0,
  userName: 'Cajera', terminalName: 'Caja 6', fiscalSyncStatus: 'SYNCED',
  ncf: 'E320000000123', ncfType: 'E32',
  items: [{ id: 'saved', name: 'Factura guardada', quantity: 1, price: 118 }],
  payments: [{ method: 'CASH', amount: 118, appliedAmount: 118 }],
};
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  return [node, ...nodes((node.props as any).children)];
}
async function harness(transaction: any = sale) {
  const states: any[] = ['EMAIL_INPUT', { type: 'CARD', label: 'Mutable' }, transaction, false, 'fixture@example.invalid', false, false, null, '', ''];
  const refs: any[] = [];
  let cursor = 0, refCursor = 0, payments = 0, cancels = 0;
  const calls: any[] = [], alerts: string[] = [], timers: Function[] = [];
  const fixture = {
    React,
    useState(initial: any) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (v: any) => { states[i] = v; }]; },
    useRef(initial: any) { const i = refCursor++; return refs[i] ||= { current: initial }; },
    send: async (payload: any) => { calls.push(payload); return fixture.response(); },
    response: async () => ({ success: true }),
    readiness: undefined as undefined | (() => Promise<undefined>),
  };
  (globalThis as any).__kioskEmailFixture = fixture;
  const bundle = await build({
    entryPoints: ['components/kiosk/KioskPayment.tsx'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    define: { 'import.meta.env': '{}' }, logLevel: 'silent', jsx: 'transform', tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    plugins: [{ name: 'isolated-email-boundaries', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hooks' }));
      b.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({ contents: 'const h=globalThis.__kioskEmailFixture;export default h.React;export const useState=h.useState,useRef=h.useRef,useMemo=f=>f();' }));
      b.onResolve({ filter: /receiptEmailService$/ }, () => ({ path: 'email', namespace: 'email' }));
      b.onLoad({ filter: /.*/, namespace: 'email' }, () => ({ contents: 'export const sendReceiptEmailViaErp=p=>globalThis.__kioskEmailFixture.send(p);' }));
      b.onLoad({ filter: /FiscalPrintEvidence\.ts$/ }, args => {
        const source = readFileSync(args.path, 'utf8').replace('export async function resolveFiscalPrintReadiness(', 'async function originalReadiness(');
        return { contents: source + '\nexport const resolveFiscalPrintReadiness=tx=>globalThis.__kioskEmailFixture.readiness?.(tx) ?? originalReadiness(tx);', loader: 'ts' };
      });
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'alert', 'setTimeout', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, (s: string) => alerts.push(s), (fn: Function) => timers.push(fn));
  const props = { cart: [{ id: 'live', name: 'Mutable cart', price: 999, quantity: 9 }], totals: { total: 9999 }, paymentMethods: [], config: { currencySymbol: 'RD$', companyInfo: { name: 'Fixture' }, terminals: [] }, users: [], onBack() {}, onPaymentComplete: async () => { payments++; return transaction; }, onPrintReceipt: async () => true, onCancel: () => { cancels++; } };
  const render = () => { cursor = refCursor = 0; return module.exports.default(props); };
  const handler = () => nodes(render()).find(n => n.type === 'button' && n.props.type === 'submit')?.props.onClick
    || nodes(render()).find(n => n.type === 'button' && n.props.disabled !== undefined && n.props.onClick)?.props.onClick;
  return { fixture, states, calls, alerts, timers, props, render, send: () => handler()(), effects: () => ({ payments, cancels }) };
}

test('kiosk emails canonical committed receipt, never live cart, total or selected payment object', async () => {
  const h = await harness(); await h.send();
  assert.equal(h.calls.length, 1);
  const payload = h.calls[0];
  assert.equal(payload.transactionId, sale.displayId);
  assert.equal(payload.total, 118); assert.equal(payload.paymentMethod, 'CASH');
  assert.equal(payload.cart[0].id, 'saved'); assert.equal(payload.tax, 18);
  assert.equal(payload.currencySymbol, 'RD$'); assert.equal(payload.companyInfo.name, 'Fixture');
  assert.equal(payload.fiscalValidated, false); assert.equal(payload.fiscalPrintEvidence, undefined);
  assert.equal(h.states[6], true); assert.equal(h.timers.length, 1);
  assert.deepEqual(h.effects(), { payments: 0, cancels: 0 });
});
for (const [label, tx] of [['precommit', null], ['missing id', { ...sale, id: '', displayId: '' }], ['blank id', { ...sale, id: ' ', displayId: '' }]] as const) {
  test(`kiosk refuses email ${label} without HTTP or payment effects`, async () => {
    const h = await harness(tx); await h.send();
    assert.equal(h.calls.length, 0); assert.equal(h.alerts.length, 1);
    assert.match(h.alerts[0], /transacci[oó]n/i);
    assert.deepEqual(h.effects(), { payments: 0, cancels: 0 });
  });
}
test('legacy committed id without displayId is retained', async () => {
  const h = await harness({ ...sale, displayId: undefined }); await h.send();
  assert.equal(h.calls[0].transactionId, sale.id);
});
test('double tap while asynchronous fiscal readiness is pending sends once', async () => {
  const h = await harness(); let release!: () => void;
  h.fixture.readiness = () => new Promise(resolve => { release = () => resolve(undefined); });
  const one = h.send(), two = h.send();
  release(); await Promise.all([one, two]); assert.equal(h.calls.length, 1);
  assert.equal(h.states[5], false);
});
for (const failure of ['offline', 'ERP rejection']) {
  test(`${failure} preserves committed sale and allows manual email retry without charging`, async () => {
    const h = await harness();
    h.fixture.response = async () => { if (failure === 'offline') throw new Error('Sin conexión'); return { success: false, message: 'ERP rechazó' } as any; };
    await h.send(); assert.equal(h.states[6], false); assert.equal(h.states[2], sale);
    assert.equal(h.states[4], 'fixture@example.invalid'); assert.equal(h.timers.length, 0);
    h.fixture.response = async () => ({ success: true }); await h.send();
    assert.deepEqual(h.calls.map(p => p.transactionId), [sale.displayId, sale.displayId]);
    assert.deepEqual(h.effects(), { payments: 0, cancels: 0 });
  });
}
test('App passes kiosk-resolved config and users into the receipt component', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const jsx = app.slice(app.indexOf('<KioskPayment\n'), app.indexOf('<KioskPayment\n') + 400);
  assert.match(jsx, /config=\{kioskPaymentConfig\}/); assert.match(jsx, /users=\{users\}/);
});

// Scoped synthetic fiscal proof: verifies the real fiscal resolver and canonical builder.
async function fiscalFixture(){
 const binding=JSON.stringify(['tenant','terminal','device','https://erp.invalid','https://erp.invalid']);
 const tx:any={id:'original',date:'2026-10-16T03:30:00Z',terminalId:'terminal',ncf:'E3200001021',electronicNcf:'E3200001021',ncfType:'E32',
  fiscalProvider:'MSELLER',fiscalSyncStatus:'PENDING',v3Binding:binding,v3InventoryBaseline:JSON.stringify([binding,'S',1,1,'C']),
  items:[{id:'P',cartId:'P',name:'Water',quantity:1,price:352,netAmount:352,taxAmount:0,totalAmount:352,v3SaleAuthority:{binding}}],
  payments:[{method:'CASH',amount:352}],total:352,netAmount:352,taxAmount:0};
 const scope:any={basis:'PERSISTED_SUBMISSION_INTENT',providerId:'MSELLER',environment:0,issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store',binding,
  sourceChecksum:await fiscalStatusSourceChecksum(tx),capturedAt:'2026-10-16T03:30:00Z'};tx.fiscalSubmissionScope=scope;
 const proof:any={schemaVersion:1,source:'ERP_SCOPED_PROVIDER_ISSUE',scope:{tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store'},
  document:{erpDocumentId:'erp-original',sourceTransactionId:tx.id,ncf:'E320000001021',ncfType:'E32',sourceChecksum:scope.sourceChecksum,total:352},
  issuer:{rnc:'130090752',providerId:'MSELLER',environment:0,credentialCompanyId:'company',credentialAccountRnc:'130090752'},
  environmentBasis:scope.basis,historicalEnvironment:null,lookup:{requestedNcf:tx.ncf},decision:'PENDING',observedAt:'2026-10-16T03:31:00Z',
  providerReceipt:{returnedNcf:'E320000001021',internalTrackId:'actual-track',status:'Validado',success:true,pending:true,invoiceTotal:352,
   printEvidence:{schemaVersion:1,qrUrl:'https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=E320000001021&MontoTotal=352.00&CodigoSeguridad=NVrTbH',securityCode:'NVrTbH',signedAt:'15-10-2026 23:30:53'}}};
 tx.fiscalPrintProof=proof;return{tx,proof,scope};
}
test('verified signed pending fiscal evidence survives kiosk email without fabricated DGII acceptance', async () => {
  const { tx, proof } = await fiscalFixture();
  const before = JSON.stringify(tx);
  const h = await harness(tx); await h.send();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].transactionId, tx.id);
  assert.equal(h.calls[0].fiscalPrintEvidence.qrUrl, proof.providerReceipt.printEvidence.qrUrl);
  assert.equal(h.calls[0].fiscalPrintEvidence.securityCode, 'NVrTbH');
  assert.equal(h.calls[0].fiscalValidated, false);
  assert.equal(JSON.stringify(tx), before);
});

test('blank recipient never prepares a request; surrounding spaces are trimmed', async () => {
  const h = await harness(); h.states[4] = '   '; await h.send();
  assert.equal(h.calls.length, 0);
  h.states[4] = ' fixture@example.invalid '; await h.send();
  assert.equal(h.calls[0].email, 'fixture@example.invalid');
});
