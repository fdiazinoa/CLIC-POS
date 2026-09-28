import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';

const storage = new Map<string, string>();
Object.assign(globalThis, {
  indexedDB,
  IDBKeyRange,
  window: { setTimeout, clearTimeout },
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  },
});

const deleteDatabase = async () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('clic_pos_indexeddb');
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});

test('strict journal transaction failure rejects without creating a localStorage fallback', async () => {
  storage.clear();
  const adapter = new IndexedDBAdapter() as any;
  const transaction: any = {
    error: new Error('synthetic transaction failure'),
    objectStore: () => ({ put: () => undefined }),
  };
  adapter.db = {
    objectStoreNames: { contains: (name: string) => name === 'legacyMutationJournal' || name === 'legacyMutationCompletions' },
    transaction: () => {
      queueMicrotask(() => transaction.onerror?.());
      return transaction;
    },
  };

  await assert.rejects(
    adapter.saveDocument('legacyMutationJournal', { id: 'journal-1', state: 'PREPARED' }),
    /synthetic transaction failure/,
  );
  assert.equal([...storage.keys()].some(key => key.includes('legacyMutationJournal')), false);
});

test('strict journal rows survive an IndexedDB restart and ignore fallback copies', async () => {
  storage.clear();
  await deleteDatabase();
  const first = new IndexedDBAdapter();
  await first.connect();
  await first.saveDocument('legacyMutationJournal', { id: 'journal-2', state: 'DISPATCHED' });
  storage.set('clic_pos_indexeddb__fallback__legacyMutationJournal', JSON.stringify([{ id: 'fallback-only', state: 'CLOSED' }]));
  await first.disconnect();

  const restarted = new IndexedDBAdapter();
  await restarted.connect();
  const rows = await restarted.getCollection<any>('legacyMutationJournal');
  assert.deepEqual(rows.map(row => row.id), ['journal-2']);
  await restarted.disconnect();
});

test('future-version database without strict stores fails closed instead of reading fallback', async () => {
  storage.clear();
  await deleteDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('clic_pos_indexeddb', 99);
    request.onupgradeneeded = () => request.result.createObjectStore('config', { keyPath: 'id' });
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  storage.set('clic_pos_indexeddb__fallback__legacyMutationJournal', JSON.stringify([{ id: 'unsafe', state: 'CLOSED' }]));

  const adapter = new IndexedDBAdapter();
  await adapter.connect();
  await assert.rejects(
    adapter.getCollection('legacyMutationJournal'),
    /LEGACY_MUTATION_DURABLE_STORE_(?:UNAVAILABLE|MISSING)/,
  );
  await adapter.disconnect();
});
