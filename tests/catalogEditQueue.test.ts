import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogEditQueue, type CatalogEdit, type CatalogResult } from '../services/sync/CatalogEditQueue';
const makeEdit = (): CatalogEdit => ({ id: 'mutation-1', scope: { tenantId: 'tenant', terminalId: 'terminal', companyId: 'company', deviceId: 'device', baseUrl: 'https://erp.test' },
    mutation: { id: 'mutation-1', recordId: 'product', domain: 'prices', field: 'precio_venta', before: 10, after: 15, actorId: 'operator' },
    label: 'Product', status: 'PENDING', attempts: 0, nextAttemptAt: 0, createdAt: '2026-09-10' });
function harness(send: (edit: CatalogEdit) => Promise<CatalogResult>, matchesScope = true, onPermanentRejection?: (edit: CatalogEdit, code: string) => Promise<void>) {
    let edit = makeEdit(); let now = 1000;
    const queue = new CatalogEditQueue({ read: async () => [structuredClone(edit)], save: async next => { edit = next; },
        matchesScope: () => matchesScope, now: () => now, send, onPermanentRejection });
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
test('a different tenant/terminal/base URL is diagnosed without entering a hot retry loop', async () => {
    let sent = 0;
    let matchesScope = false;
    let edit = makeEdit();
    let now = 1000;
    const queue = new CatalogEditQueue({
        read: async () => [structuredClone(edit)],
        save: async next => { edit = next; },
        matchesScope: () => matchesScope,
        now: () => now,
        send: async () => { sent++; return { id: 'mutation-1', status: 'APPLIED' }; },
    });

    await queue.process();
    assert.equal(sent, 0);
    assert.equal(edit.status, 'PENDING');
    assert.equal(edit.syncStatus, 'ERROR');
    assert.equal(edit.syncError, 'CATALOG_EDIT_SCOPE_MISMATCH');
    assert.equal(edit.nextAttemptAt, 301000);

    await queue.process();
    assert.equal(sent, 0, 'the same mismatch is not rewritten or sent before its recheck');

    matchesScope = true;
    now = edit.nextAttemptAt;
    await queue.process();
    assert.equal(sent, 1);
    assert.equal(edit.status, 'APPLIED');
});
test('an unrelated or missing ACK is never marked applied', async () => {
    const h = harness(async () => ({ id: 'other-id', status: 'APPLIED' }));
    await h.queue.process(); assert.equal(h.get().status, 'PENDING');
});
test('conflicts remain visible and are not automatically overwritten or retried', async () => {
    let sent = 0; const h = harness(async () => { sent++; return { id: 'mutation-1', status: 'CONFLICT', current: 99 }; });
    await h.queue.process(); h.advance(); await h.queue.process();
    assert.equal(sent, 1); assert.equal(h.get().status, 'CONFLICT'); assert.match(h.get().message!, /99/);
    assert.equal(h.get().conflictCurrent, 99);
});
test('a terminal catalog permission 403 is rejected once and restores the optimistic value', async () => {
    let sent = 0;
    const restored: Array<[string, string]> = [];
    const h = harness(async () => {
        sent += 1;
        throw Object.assign(new Error('Operational sync failed: 403 — Terminal sin permiso de edición de catálogo.'), { httpStatus: 403 });
    }, true, async (edit, code) => { restored.push([edit.id, code]); });
    await h.queue.process();
    assert.equal(h.get().status, 'REJECTED');
    assert.equal(h.get().syncStatus, 'ERROR');
    assert.equal(h.get().syncError, 'CATALOG_EDIT_FORBIDDEN');
    assert.match(h.get().message!, /restauró el valor anterior/);
    assert.deepEqual(restored, [['mutation-1', 'CATALOG_EDIT_FORBIDDEN']]);
    h.advance();
    await h.queue.process();
    assert.equal(sent, 1);
});
test('a stale baseline is applied when ERP already has the requested value', async () => {
    const h = harness(async () => ({ id: 'mutation-1', status: 'CONFLICT', current: 15 }));
    await h.queue.process();
    assert.equal(h.get().status, 'APPLIED');
    assert.equal(h.get().syncStatus, 'SYNCED');
    assert.equal(h.get().conflictCurrent, undefined);
});
test('concurrent workers share one send', async () => {
    let sent = 0; const h = harness(async () => { sent++; return { id: 'mutation-1', status: 'APPLIED' }; });
    await Promise.all([h.queue.process(), h.queue.process()]); assert.equal(sent, 1);
});
test('successive offline changes send in order and only after predecessor acknowledgement', async () => {
    let rows = [makeEdit(), { ...makeEdit(), id: 'second', mutation: { ...makeEdit().mutation, id: 'second', before: 15, after: 20 }, dependsOn: 'mutation-1', createdAt: '2026-09-11' }];
    const sent: string[] = [];
    const q = new CatalogEditQueue({ read: async () => structuredClone(rows), save: async next => { rows = rows.map(row => row.id === next.id ? next : row); },
        matchesScope: () => true, now: () => 1000, send: async edit => { sent.push(edit.id); return { id: edit.id, status: 'APPLIED' }; } });
    await q.process(); assert.deepEqual(sent, ['mutation-1', 'second']);
});
test('conflict on the first change blocks later offline values', async () => {
    let rows = [makeEdit(), { ...makeEdit(), id: 'second', dependsOn: 'mutation-1', createdAt: '2026-09-11' }];
    const sent: string[] = [];
    const q = new CatalogEditQueue({ read: async () => structuredClone(rows), save: async next => { rows = rows.map(row => row.id === next.id ? next : row); },
        matchesScope: () => true, now: () => 1000, send: async edit => { sent.push(edit.id); return { id: edit.id, status: 'CONFLICT' }; } });
    await q.process(); assert.deepEqual(sent, ['mutation-1']); assert.equal(rows[1].status, 'CONFLICT');
});
test('large queues yield in chunks and pause before sending more work during a sale', async () => {
    let rows = Array.from({ length: 60 }, (_, index) => {
        const id = `mutation-${index + 1}`;
        return {
            ...makeEdit(),
            id,
            mutation: { ...makeEdit().mutation, id },
            createdAt: `2026-09-10T00:00:${String(index).padStart(2, '0')}.000Z`,
        };
    });
    const sent: string[] = [];
    let paused = false;
    let yields = 0;
    const q = new CatalogEditQueue({
        read: async () => structuredClone(rows),
        save: async next => { rows = rows.map(row => row.id === next.id ? next : row); },
        matchesScope: () => true,
        now: () => 1000,
        send: async edit => { sent.push(edit.id); return { id: edit.id, status: 'APPLIED' }; },
        chunkSize: 25,
        shouldPause: () => paused,
        yieldToUi: async () => { yields += 1; paused = true; },
    });

    await q.process();
    assert.equal(sent.length, 25);
    assert.equal(yields, 1);
    assert.equal(rows.filter(row => row.status === 'PENDING').length, 35);

    paused = false;
    await q.process();
    assert.equal(sent.length, 50);
    assert.equal(rows.filter(row => row.status === 'PENDING').length, 10);

    paused = false;
    await q.process();
    assert.equal(sent.length, 60);
    assert.equal(rows.filter(row => row.status === 'PENDING').length, 0);
});
test('a queue paused at entry sends nothing until operator activity ends', async () => {
    let row = makeEdit();
    let paused = true;
    let sent = 0;
    const q = new CatalogEditQueue({
        read: async () => [structuredClone(row)],
        save: async next => { row = next; },
        matchesScope: () => true,
        now: () => 1000,
        send: async edit => { sent += 1; return { id: edit.id, status: 'APPLIED' }; },
        shouldPause: () => paused,
    });

    await q.process();
    assert.equal(sent, 0);
    assert.equal(row.status, 'PENDING');

    paused = false;
    await q.process();
    assert.equal(sent, 1);
    assert.equal(row.status, 'APPLIED');
});
test('operator activity starting during a send pauses before the next mutation', async () => {
    let rows = [makeEdit(), {
        ...makeEdit(),
        id: 'mutation-2',
        mutation: { ...makeEdit().mutation, id: 'mutation-2' },
        createdAt: '2026-09-11',
    }];
    let paused = false;
    const sent: string[] = [];
    const q = new CatalogEditQueue({
        read: async () => structuredClone(rows),
        save: async next => { rows = rows.map(row => row.id === next.id ? next : row); },
        matchesScope: () => true,
        now: () => 1000,
        send: async edit => { sent.push(edit.id); paused = true; return { id: edit.id, status: 'APPLIED' }; },
        shouldPause: () => paused,
    });

    await q.process();
    assert.deepEqual(sent, ['mutation-1']);
    assert.equal(rows[1].status, 'PENDING');

    paused = false;
    await q.process();
    assert.deepEqual(sent, ['mutation-1', 'mutation-2']);
    assert.equal(rows[1].status, 'APPLIED');
});
