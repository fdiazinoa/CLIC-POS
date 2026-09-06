import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckoutDiagnosticRecorder, checkoutDiagnostics, recordCheckoutDiagnostic, setCheckoutTrackingEnabled, getCheckoutTrackingSession } from '../services/CheckoutDiagnostics';
const line = { id: 'product-1', cartId: 'line-1', name: 'Producto', price: 30, quantity: 1 };

test('disabled diagnostic path schedules nothing and does not inspect sale data', () => {
    const data = { get items(): unknown { throw new Error('must not be inspected'); } };
    recordCheckoutDiagnostic('CHECKOUT_CONFIRM', data);
    assert.equal(checkoutDiagnostics.snapshot().recent.length, 0);
    assert.equal(getCheckoutTrackingSession(), null);
});

test('recording never invokes storage synchronously or mutates transaction/cart input', async () => {
    let writes = 0;
    let scheduled = 0;
    const recorder = new CheckoutDiagnosticRecorder(async () => { writes++; }, () => { scheduled++; });
    const items = [Object.freeze({ ...line })];
    recorder.record('CHECKOUT_OPEN', { items, total: 30 });
    assert.equal(writes, 0);
    assert.equal(scheduled, 1);
    items.length = 0;
    const before = recorder.snapshot().recent[0];
    assert.equal(before.data.itemCount, 1);
    assert.deepEqual(before.data.lines, [{ id: line.id, cartId: line.cartId, name: line.name, quantity: 1, price: 30, total: null, net: null, tax: null }]);
    await recorder.flush();
    assert.equal(writes, 1);
});

test('table cart loss is pinned with preceding commercial lines and stable event references', () => {
    const recorder = new CheckoutDiagnosticRecorder(async () => {});
    recorder.record('CHECKOUT_OPEN', { items: [line], total: 30, tableId: 'table-1', orderId: 'order-1' });
    recorder.record('TABLE_CART_CLEAR', { items: [line], reason: 'ORDER_NOT_FOUND', tableId: 'table-1' });
    recorder.record('CART_RENDER', { items: [], total: 0 });
    recorder.record('TRANSACTION_CREATED', { items: [], total: 0, transactionId: 'txn-464', displayId: 'TCK-464' });
    recorder.record('OUTBOX_SEND', { items: [], total: 0, transactionId: 'txn-464', eventId: 'stable-event' });
    const records = recorder.snapshot().recent;
    assert.equal(records[2].anomaly, true);
    assert.equal(records[0].checkoutId, records[4].checkoutId);
    for (let i = 0; i < 1000; i++) recorder.record('OTHER');
    const snapshot = recorder.snapshot();
    assert.equal(snapshot.recent.length, 128);
    assert.equal(snapshot.incidents[0].records[0].data.itemCount, 1);
    assert.equal(snapshot.incidents[0].records[0].data.tableId, 'table-1');
});

test('normal cart cleanup after durable commit is not a missing-lines incident', () => {
    const recorder = new CheckoutDiagnosticRecorder(async () => {});
    recorder.record('CHECKOUT_OPEN', { items: [line], total: 30 });
    recorder.record('FINANCIAL_COMMIT_OK', { items: [line], total: 30, transactionId: 'tx-1' });
    recorder.record('CART_RENDER', { items: [], total: 0 });
    assert.equal(recorder.snapshot().incidents.length, 0);
});

test('projection excludes credentials, card data, customer PII and image/catalog payloads', () => {
    const recorder = new CheckoutDiagnosticRecorder(async () => {});
    recorder.record('CHECKOUT_OPEN', { items: [{ ...line, image: 'secret-image', token: 'secret-token', customer: { email: 'secret-email' } }],
        payments: [{ id: 'p-1', method: 'CARD', amount: 30, pan: 'secret-pan', cvv: 'secret-cvv', authorization: 'secret-auth' }] });
    assert.doesNotMatch(JSON.stringify(recorder.snapshot()), /secret-/);
});

test('malformed data or storage failure never throws into checkout; queue remains bounded and retryable', async () => {
    let shouldFail = true;
    let saved = 0;
    const recorder = new CheckoutDiagnosticRecorder(async records => { if (shouldFail) throw new Error('disk unavailable'); saved += records.length; });
    assert.doesNotThrow(() => recorder.record('CHECKOUT_OPEN', { get items(): unknown { throw new Error('bad getter'); } }));
    for (let i = 0; i < 1000; i++) recorder.record('OTHER');
    await assert.doesNotReject(recorder.flush());
    shouldFail = false;
    await recorder.flush();
    assert.equal(saved, 256);
});

test('record sizes and pinned incidents are bounded', () => {
    const recorder = new CheckoutDiagnosticRecorder(async () => {});
    recorder.record('CHECKOUT_OPEN', { items: Array.from({ length: 1000 }, () => ({ ...line, name: 'x'.repeat(1000) })) });
    assert.equal((recorder.snapshot().recent[0].data.lines as any[]).length, 100);
    assert.equal(recorder.snapshot().recent[0].data.itemCount, 1000);
    assert.equal(recorder.snapshot().recent[0].data.linesTruncated, true);
    for (let i = 0; i < 100; i++) recorder.record('CHECKOUT_CONFIRM', { items: [] });
    assert.equal(recorder.snapshot().incidents.length, 10);
});

test('enabling creates a stable 24-hour tracking session; disabling stops capture', () => {
    const session = setCheckoutTrackingEnabled(true, { versionName: 'diagnostic-test', terminalId: 'terminal-1' });
    assert.equal(Date.parse(session!.expiresAt) - Date.parse(session!.startedAt), 24 * 60 * 60_000);
    recordCheckoutDiagnostic('CHECKOUT_OPEN', { items: [line] });
    const event = checkoutDiagnostics.snapshot().recent.at(-1)!;
    assert.equal(event.session?.id, session?.id);
    assert.equal(event.session?.versionName, 'diagnostic-test');
    setCheckoutTrackingEnabled(false);
    const count = checkoutDiagnostics.snapshot().recent.length;
    recordCheckoutDiagnostic('CHECKOUT_CONFIRM', { items: [] });
    assert.equal(checkoutDiagnostics.snapshot().recent.length, count);
});
