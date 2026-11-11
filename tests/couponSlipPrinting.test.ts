import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEscPosCouponSlipsPayload, buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { couponSlipsHtml } from '../utils/couponSlipPresentation';
import type { CouponIssuanceEnvelope } from '../services/coupons/CouponIssuanceClient';
const config: any = { companyInfo: { name: 'Absolute', rnc: '', address: '', phone: '' }, taxes: [], terminals: [], receiptConfig: { showQr: false }, currencies: [], currencySymbol: 'RD$' };
const result: CouponIssuanceEnvelope = { contractVersion: 1, tenantId: 'tenant', terminalId: 'terminal', transactionId: 'sale', receiptReference: 'TCK1', status: 'ISSUED', coupons: [{ id: 'coupon', promotionId: 'promo', code: 'CUPON-NEW-1234', campaignName: 'Proxima compra', benefitType: 'PERCENT', benefitValue: 10, validFrom: '2026-11-11T12:00:00Z', expiresAt: '2026-11-30T12:00:00Z' }] };
const cut = Buffer.from([0x1d, 0x56, 66, 0]);
const cuts = (bytes: Buffer) => { let count = 0, at = 0; while ((at = bytes.indexOf(cut, at)) >= 0) { count++; at += cut.length; } return count; };
test('invoice and coupon are separate artifacts, each with its own cut and QR code of issued coupon', () => {
  const tx: any = { id: 'sale', displayId: 'TCK1', date: '2026-11-11T12:00:00Z', total: 100, items: [{ id: 'P', name: 'Articulo', price: 100, quantity: 1 }], payments: [] };
  const invoice = Buffer.from(buildEscPosTicketPayload(tx, config)!, 'base64');
  const slip = Buffer.from(buildEscPosCouponSlipsPayload(result, config, Date.parse('2026-11-12'))!, 'base64');
  assert.equal(cuts(invoice), 1); assert.equal(cuts(slip), 1);
  assert.ok(!invoice.includes(Buffer.from('CUPON-NEW-1234')));
  const qrData = Buffer.concat([Buffer.from([0x31, 0x50, 0x30]), Buffer.from('CUPON-NEW-1234')]);
  assert.ok(slip.includes(qrData), 'native QR data must be the issued coupon code');
  assert.match(slip.toString(), /10% de descuento/); assert.match(slip.toString(), /Compra origen: TCK1/);
});
test('multiple coupons each receive one cut, never an extra invoice copy', () => {
  const many = { ...result, coupons: [...result.coupons, { ...result.coupons[0], id: 'coupon2', code: 'CUPON-NEW-5678', promotionId: 'promo2' }] };
  assert.equal(cuts(Buffer.from(buildEscPosCouponSlipsPayload(many, config)!, 'base64')), 2);
  assert.equal(buildEscPosCouponSlipsPayload({ ...result, status: 'NOT_ELIGIBLE', coupons: [] }, config), null);
});
test('browser uses separate pages and escapes text; expired reprint never extends validity', async () => {
  const requested: string[] = [];
  const html = await couponSlipsHtml({ ...result, coupons: [{ ...result.coupons[0], campaignName: '<Promo & algo>' }] }, '<Absolute>', async code => { requested.push(code); return '<svg></svg>'; }, Date.parse('2027-01-01'));
  assert.deepEqual(requested, ['CUPON-NEW-1234']); assert.match(html, /break-after:page/);
  assert.match(html, /&lt;Promo &amp; algo&gt;/); assert.match(html, /&lt;Absolute&gt;/);
  assert.match(html, /CUPON VENCIDO - NO CANJEABLE/); assert.match(html, /2026-11-30/);
});

test('actual print orchestration isolates optional issuance failures, retries only coupon, and makes zero calls when disabled', async () => {
  const { build } = await import('esbuild');
  const { createRequire } = await import('node:module');
  const tx: any = { id: 'sale', displayId: 'TCK1', documentType: 'TICKET', status: 'COMPLETED', date: '2026-11-11T12:00:00Z', total: 100, userName: 'Ana', items: [{ id: 'P', name: 'Articulo', price: 100, quantity: 1 }], payments: [] };
  const env = { native: true, suppress: true, durable: tx, calls: 0, jobs: [] as any[], notices: [] as string[], fail: false, result,
    identity: { tenantId: 'tenant', terminalId: 'terminal', deviceId: 'device', erpSyncBaseUrl: 'https://erp.invalid/api/sync', syncToken: 'synthetic' } };
  (globalThis as any).__couponPrintingFixture = env;
  try {
    const compiled = await build({ entryPoints: ['utils/printer.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'print-fixture', setup(b) {
      b.onResolve({ filter: /(?:\/db|FiscalPrintEvidence|CheckoutPrintTracking|PrintRouterService|PrintFeedback|PrintRuntime|ClicDialogService|CouponIssuanceRuntime)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: 'const E=globalThis.__couponPrintingFixture;' + (
        path.endsWith('/db') ? 'exports.dbAdapter={getDocument:async()=>E.durable,getCollection:async()=>[]};' :
        path.endsWith('FiscalPrintEvidence') ? 'exports.resolveFiscalPrintReadiness=async()=>undefined;exports.fiscalPrintTransaction=t=>t;exports.isVerifiedFiscalPrintDisplay=()=>false;' :
        path.endsWith('CheckoutPrintTracking') ? 'exports.trackCheckoutPrint=(_meta,action)=>action();' :
        path.endsWith('PrintRouterService') ? 'exports.PrintRouterService={routeAndPrintEscPos:async job=>{E.jobs.push(job);return E.native;},routeAndPrintHtml:async()=>false};' :
        path.endsWith('PrintFeedback') ? 'exports.PrintOutputError=Error;exports.runPrintTask=(_key,_title,action)=>action();' :
        path.endsWith('PrintRuntime') ? 'exports.shouldSuppressBrowserPrintFallback=()=>E.suppress;' :
        path.endsWith('ClicDialogService') ? 'exports.clicAlert=async message=>{E.notices.push(message);};' :
        'exports.readCouponPrintIdentity=()=>E.identity;exports.acquireReceiptCoupons=async()=>{E.calls++;if(E.fail)throw Error("pending");return E.result;};'
      ) }));
    } }] });
    const module = { exports: {} as any };
    new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
    const before = JSON.stringify(tx);
    assert.equal(await module.exports.printTicket(tx, config), true);
    assert.equal(env.calls, 0); assert.equal(env.jobs.length, 1);
    const enabled = { ...config, receiptConfig: { ...config.receiptConfig, printCouponSlip: true } };
    env.fail = true;
    assert.equal(await module.exports.printTicket(tx, enabled), true, 'accepted invoice remains accepted when coupon is pending');
    assert.equal(env.jobs.length, 2, 'pending issuance sends no invented slip'); assert.equal(env.notices.length, 1);
    env.fail = false;
    assert.equal(await module.exports.printCouponForTransaction(tx, enabled), true);
    assert.equal(env.jobs.length, 3); assert.match(env.jobs[2].referenceId, /^coupon-slip:/);
    assert.equal(env.jobs[2].copies, 1); assert.ok(Buffer.from(env.jobs[2].escPosBase64, 'base64').includes(Buffer.from('CUPON-NEW-1234')));
    assert.equal(JSON.stringify(tx), before);
    assert.equal(await module.exports.printCouponForTransaction({ ...tx, documentType: 'REFUND' }, enabled), false);
    assert.equal(env.calls, 2, 'refund makes no issuance request');
    const previousWindow = (globalThis as any).window;
    let browserHtml = '', printRequests = 0;
    (globalThis as any).window = { open: () => ({ document: { write: (html: string) => { browserHtml = html; }, close() {} }, focus() {}, print() { printRequests++; } }) };
    try {
      env.native = false; env.suppress = false;
      assert.equal(await module.exports.printCouponForTransaction(tx, enabled), true);
      assert.equal(printRequests, 1, 'ordinary browser fallback must request its print dialog');
      assert.match(browserHtml, /CUPON-NEW-1234/); assert.match(browserHtml, /break-after:page/);
    } finally { (globalThis as any).window = previousWindow; }
  } finally { delete (globalThis as any).__couponPrintingFixture; }
});
