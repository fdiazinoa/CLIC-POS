import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Execute the real reader with only its native persistence boundary replaced.
const bundle = await build({
  entryPoints: [new URL('../services/sync/LargeMasterSyncV3RetainedCheckout.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'native-table-fixture', setup(builder) {
    builder.onResolve({ filter: /^(\.\.\/\.\.\/utils\/db|\.\.\/db)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === '../db'
      ? 'export const dbAdapter={isV3TicketClosed:async()=>globalThis.__emptyTableFixture.closed};'
      : 'export const db={getDocument:async(collection,id)=>globalThis.__emptyTableFixture.documents[collection]?.[id] ?? null};' }));
  } }],
});
const reader = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id = 'TABLE-TABLE_01-ACCOUNT-1792620467171-1';
const account = () => ({ id, name: 'M01 - Cuenta 1', tableId: 'TABLE_01', items: [], total: 0 });
function fixture(document: any = account(), collection = 'parkedTickets', closed = false) {
  Object.assign(globalThis, { __emptyTableFixture: { documents: { [collection]: { [id]: document } }, closed } });
}

test('new durable table account permits the first current-catalog article without mutating its source', async () => {
  const source = account(); fixture(source);
  const retained = await reader.readV3RetainedCheckout({ ticketId: id, tableId: 'TABLE_01' });
  assert.equal(retained.collection, 'parkedTickets');
  assert.equal(retained.expected, JSON.stringify(source));
  assert.deepEqual(retained.items, []);
  assert.equal(reader.isVerifiedV3RetainedContext(retained), true);
  // An empty table must never become evidence for a historical catalogue line.
  assert.throws(() => reader.assertV3RetainedLine({ id: 'article', cartId: 'line' }, retained), /RETAINED_LINE_CHANGED/);
  assert.deepEqual(source, account());
});

for (const [name, document, reference] of [
  ['missing source', null, { ticketId: id, tableId: 'TABLE_01' }],
  ['missing table reference', account(), { ticketId: id }],
  ['another table', account(), { ticketId: id, tableId: 'TABLE_02' }],
  ['nonzero amount', { ...account(), total: 85 }, { ticketId: id, tableId: 'TABLE_01' }],
  ['missing amount', { ...account(), total: undefined }, { ticketId: id, tableId: 'TABLE_01' }],
  ['malformed lines', { ...account(), items: null }, { ticketId: id, tableId: 'TABLE_01' }],
  ['wrong document identity', { ...account(), id: 'another' }, { ticketId: id, tableId: 'TABLE_01' }],
] as const) test('empty account rejects ' + name, async () => {
  fixture(document);
  await assert.rejects(() => reader.readV3RetainedCheckout(reference), /RETAINED_SOURCE_REQUIRED/);
});

test('closed empty table remains blocked', async () => {
  fixture(account(), 'parkedTickets', true);
  await assert.rejects(() => reader.readV3RetainedCheckout({ ticketId: id, tableId: 'TABLE_01' }), /RETAINED_TICKET_CHANGED/);
});

test('empty restored direct ticket remains blocked', async () => {
  fixture({ ...account(), state: 'PENDING' }, 'v3RestoredTicketSources');
  await assert.rejects(() => reader.readV3RetainedCheckout({ ticketId: id, claimId: id, tableId: 'TABLE_01' }), /RETAINED_SOURCE_REQUIRED/);
});

test('empty refund source remains blocked', async () => {
  fixture(account(), 'transactions');
  await assert.rejects(() => reader.readV3RetainedCheckout({ originalTransactionId: id, tableId: 'TABLE_01' }, true), /RETAINED_SOURCE_REQUIRED/);
});

test('nonempty retained table still verifies the exact durable lines', async () => {
  const line = { id: 'article', cartId: 'existing', quantity: 1, price: 85 };
  fixture({ ...account(), items: [line], total: 85 });
  const retained = await reader.readV3RetainedCheckout({ ticketId: id, tableId: 'TABLE_01' });
  assert.doesNotThrow(() => reader.assertV3RetainedLine(line, retained));
  assert.throws(() => reader.assertV3RetainedLine({ ...line, price: 999 }, retained), /RETAINED_LINE_CHANGED/);
});
