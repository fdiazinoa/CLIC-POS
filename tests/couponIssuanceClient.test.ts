import test from 'node:test';
import assert from 'node:assert/strict';
import { createCouponIssuanceClient, validateCouponIssuance, type CouponIssuanceEnvelope } from '../services/coupons/CouponIssuanceClient';
import { financialIdentity } from '../services/db/LargeMasterSyncV3FinancialRetention';

const identity = () => ({ erpSyncBaseUrl: 'https://erp.invalid/api/sync', tenantId: 'tenant', terminalId: 'erp-terminal', deviceId: 'device', syncToken: 'synthetic' });
const sale: any = { id: 'sale', displayId: 'TCK1', documentType: 'TICKET', status: 'COMPLETED', total: 100, items: [], payments: [] };
const decision = (): CouponIssuanceEnvelope => ({ contractVersion: 1, tenantId: 'tenant', terminalId: 'erp-terminal', transactionId: 'sale', receiptReference: 'TCK1', status: 'ISSUED', coupons: [{ id: 'coupon', code: 'CUPON-RANDOM-1234', promotionId: 'promo', campaignName: 'Proxima compra', benefitType: 'PERCENT', benefitValue: 10, validFrom: '2026-11-11T12:00:00Z', expiresAt: '2026-12-11T12:00:00Z' }] });
function fixture() {
  let current = identity(), calls = 0;
  let request = async () => decision();
  const get = createCouponIssuanceClient({ readIdentity: () => current, request: async () => { calls++; return request(); } });
  return { get, calls: () => calls, drift: () => { current = { ...current, deviceId: 'other' }; }, hold: (action: typeof request) => { request = action; } };
}
test('concurrent print and reprint reuse exactly one validated issuance without changing financial identity', async () => {
  const f = fixture(), before = financialIdentity(sale), raw = JSON.stringify(sale);
  const [a, b] = await Promise.all([f.get(sale), f.get(sale)]);
  assert.deepEqual(a, b); assert.equal(f.calls(), 1);
  const reprint = await f.get(sale); assert.deepEqual(reprint, a); assert.equal(f.calls(), 2, 'reprint revalidates central ledger and catalogs');
  assert.equal(financialIdentity(sale), before); assert.equal(JSON.stringify(sale), raw);
});
test('an empty ERP decision stays empty and each reprint is revalidated', async () => {
  const f = fixture(); f.hold(async () => ({ ...decision(), status: 'NOT_ELIGIBLE', coupons: [] }));
  assert.deepEqual((await f.get(sale)).coupons, []);
  assert.deepEqual((await f.get(sale)).coupons, []); assert.equal(f.calls(), 2);
});
for (const change of [
  { documentType: 'REFUND' }, { documentType: 'VOID' }, { status: 'PENDING' }, { status: 'REFUNDED' }, { status: 'PARTIAL_REFUND' }, { originalTransactionId: 'original' },
]) test(`non-sale context never requests issuance ${JSON.stringify(change)}`, async () => {
  const f = fixture(); await assert.rejects(f.get({ ...sale, ...change })); assert.equal(f.calls(), 0);
});
test('identity drift while the ERP is responding cannot publish that result', async () => {
  const f = fixture(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.hold(async () => { await held; return decision(); });
  const pending = f.get(sale), rejected = assert.rejects(pending);
  await new Promise(resolve => setImmediate(resolve)); f.drift(); release(); await rejected;
  assert.equal(f.calls(), 1);
});
test('network failure is retryable and never becomes a successful issuance', async () => {
  const f = fixture(); f.hold(async () => { throw Error('offline'); });
  await assert.rejects(f.get(sale)); assert.equal(f.calls(), 1);
  f.hold(async () => decision()); assert.equal((await f.get(sale)).coupons[0].code, 'CUPON-RANDOM-1234');
});
for (const mutate of [
  (r: any) => { r.tenantId = 'other'; }, (r: any) => { r.terminalId = 'other'; }, (r: any) => { r.transactionId = 'other'; },
  (r: any) => { r.contractVersion = 2; }, (r: any) => { r.status = 'NOT_ELIGIBLE'; },
  (r: any) => { r.coupons[0].code = 'TCK1\x1dV'; }, (r: any) => { r.coupons[0].benefitValue = 101; },
  (r: any) => { r.coupons[0].expiresAt = 'invalid'; }, (r: any) => { r.coupons.push(r.coupons[0]); },
]) test(`malformed or foreign response is denied (${mutate.toString()})`, () => {
  const value = decision(); mutate(value); assert.throws(() => validateCouponIssuance(value, identity(), sale.id));
});

 test('a previously printed coupon is not returned locally after the ERP removes its catalog', async () => {
  const f = fixture(); await f.get(sale);
  f.hold(async () => { throw Error('COUPON_ISSUANCE_UNAVAILABLE'); });
  await assert.rejects(f.get(sale)); assert.equal(f.calls(), 2);
 });
