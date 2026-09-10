import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogEditQueue, type CatalogEdit, type CatalogResult } from '../services/sync/CatalogEditQueue';
const makeEdit = (): CatalogEdit => ({ id: 'mutation-1', scope: { tenantId: 'tenant', terminalId: 'terminal', companyId: 'company', deviceId: 'device', baseUrl: 'https://erp.test' },
    mutation: { id: 'mutation-1', recordId: 'product', domain: 'prices', field: 'precio_venta', before: 10, after: 15, actorId: 'operator' },
    label: 'Product', status: 'PENDING', attempts: 0, nextAttemptAt: 0, createdAt: '2026-09-10' });
function harness(send: (edit: CatalogEdit) => Promise<CatalogResult>, matchesScope = true) {
    let edit = makeEdit(); let now = 1000;
    const queue = new CatalogEditQueue({ read: async () => [structuredClone(edit)], save: async next => { edit = next; },
        matchesScope: () => matchesScope, now: () => now, send });
    return { queue, get: () => edit, advance: () => { now += 400000; } };
}
test('lost ACK retries the same immutable mutation after backoff, then applies', async () => {
    const sent: CatalogEdit[] = [];
    const h = harness(async edit => { sent.push(structuredClone(edit)); if (sent.length === 1) throw new Error('Offline'); return { id: edit.id, status: 'APPLIED' }; });
    await h.queue.process(); assert.equal(h.get().status, 'PENDING'); assert.equal(h.get().attempts, 1);
    await h.queue.process(); assert.equal(sent.length, 1);
    h.advance(); await h.queue.process(); assert.equal(h.get().status, 'APPLIED');
    assert.deepEqual(sent[0].mutation, sent[1].mutation);
    await h.queue.process(); assert.equal(sent.length, 2);
});
test('a different tenant/terminal/base URL never sends pending mutations', async () => {
    let sent = 0; const h = harness(async () => { sent++; return { id: 'mutation-1', status: 'APPLIED' }; }, false);
    await h.queue.process(); assert.equal(sent, 0); assert.equal(h.get().status, 'PENDING');
});
test('an unrelated or missing ACK is never marked applied', async () => {
    const h = harness(async () => ({ id: 'other-id', status: 'APPLIED' }));
    await h.queue.process(); assert.equal(h.get().status, 'PENDING');
});
test('conflicts remain visible and are not automatically overwritten or retried', async () => {
    let sent = 0; const h = harness(async () => { sent++; return { id: 'mutation-1', status: 'CONFLICT', current: 99 }; });
    await h.queue.process(); h.advance(); await h.queue.process();
    assert.equal(sent, 1); assert.equal(h.get().status, 'CONFLICT'); assert.match(h.get().message!, /99/);
});
test('concurrent workers share one send', async () => {
    let sent = 0; const h = harness(async () => { sent++; return { id: 'mutation-1', status: 'APPLIED' }; });
    await Promise.all([h.queue.process(), h.queue.process()]); assert.equal(sent, 1);
});
