import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
test('database upgrade preserves products and pending proposals survive reopening', async () => {
    Object.assign(globalThis, { indexedDB, IDBKeyRange,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        window: { setTimeout, clearTimeout } });
    await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('clic_pos_indexeddb', 22);
        open.onupgradeneeded = () => { open.result.createObjectStore('products', { keyPath: 'id' }).add({ id: 'existing-product', price: 10 }); };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => { open.result.close(); resolve(); };
    });
    const first = new IndexedDBAdapter(); await first.connect();
    await first.saveDocument('catalogEdits', { id: 'proposal', status: 'PENDING', mutation: { before: 10, after: 15 } });
    await first.saveDocument('catalogEditCache', { id: 'cached-catalog', records: [{ id: 'existing-product' }] });
    await first.disconnect();
    const second = new IndexedDBAdapter(); await second.connect();
    assert.equal((await second.getDocument<any>('catalogEdits', 'proposal'))?.status, 'PENDING');
    assert.equal((await second.getDocument<any>('products', 'existing-product'))?.price, 10);
    assert.equal((await second.getDocument<any>('catalogEditCache', 'cached-catalog'))?.records.length, 1);
    await second.disconnect();
});
