import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ParkedTicket } from '../types';
import { commitRetiredTableAccountAfterAck } from '../utils/tableAccountRetirement';
import { mergeParkedTicketsForTable } from '../server/tableTicketMerge';

const ticket = (id: string): ParkedTicket => ({ id, tableId: 'mesa-7', name: id, items: [], timestamp: '2026-10-03T19:00:00Z' });

test('poll Master y Cliente no publica source retirado mientras PUT está sin ACK', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const fetchTables = app.slice(app.indexOf('const fetchTables ='), app.indexOf('const handleUpdateParkedTickets'));
  const update = app.slice(app.indexOf('const handleUpdateParkedTickets'), app.indexOf('const handleParkedOrderSplitFromMap'));
  assert.equal((update.match(/speculativeRetirement: publishAfterAck/g) || []).length, 2);
  assert.match(fetchTables, /pendingTableSync = isClientRuntime\s*\? pendingClientTableSyncRef\.current\s*: pendingMasterTableSyncRef\.current/);
  assert.match(fetchTables, /if \(pendingTableSync\?\.speculativeRetirement\) \{[\s\S]*?return \{ ok: true \};/);
  assert.ok(fetchTables.indexOf('if (pendingTableSync?.speculativeRetirement)') < fetchTables.indexOf('mergePendingClientTableTickets(responseParkedTickets, pendingTableSync)'));
  assert.ok(fetchTables.indexOf('if (pendingTableSync?.speculativeRetirement)') < fetchTables.indexOf('if (hasUnchangedClientRevision && !pendingTableSync)'));
  assert.match(update, /if \(!publishAfterAck\) \{\s*writePendingTableSyncMirror\(pendingSync\);[\s\S]*?setParkedTickets\(validTickets\);/);
  assert.match(update, /if \(!publishAfterAck\) \{\s*if \(!changedTicketId\) writeCriticalCollectionsMirror\(validTickets, cashMovements\);[\s\S]*?setParkedTickets\(validTickets\);/);
});

test('retire espera ACK exacto y guardado durable antes de quitar origen de UI', async () => {
  const target = ticket('target');
  let resolveSave!: () => void;
  const delayedSave = new Promise<void>(resolve => { resolveSave = resolve; });
  const effects: string[] = [];
  const action = commitRetiredTableAccountAfterAck({
    expected: [target], acknowledged: [target], tableId: 'mesa-7', sourceId: 'source',
    persist: async () => { effects.push('save-start'); await delayedSave; effects.push('save-end'); },
    publish: () => { effects.push('publish'); },
  });
  assert.deepEqual(effects, ['save-start']);
  resolveSave();
  await action;
  assert.deepEqual(effects, ['save-start', 'save-end', 'publish']);
});

test('ACK faltante, rechazado o con source fantasma no guarda ni publica', async () => {
  const target = ticket('target');
  const effects: string[] = [];
  const input = { expected: [target], tableId: 'mesa-7', sourceId: 'source',
    persist: async () => { effects.push('save'); }, publish: () => { effects.push('publish'); } };
  for (const acknowledged of [undefined, [target, ticket('source')], [], [{ ...target, total: 999 }]]) {
    await assert.rejects(commitRetiredTableAccountAfterAck({ ...input, acknowledged }), /PARKED_TICKETS_ACK/);
  }
  await assert.rejects(commitRetiredTableAccountAfterAck({ ...input, expected: [ticket('source'), target], acknowledged: [target] }), /SOURCE_STILL_PRESENT/);
  assert.deepEqual(effects, []);
});

test('fallo SQLite después de ACK no publica retiro local', async () => {
  const target = ticket('target');
  let published = false;
  await assert.rejects(commitRetiredTableAccountAfterAck({
    expected: [target], acknowledged: [target], tableId: 'mesa-7', sourceId: 'source',
    persist: async () => { throw new Error('SQLite unavailable'); },
    publish: () => { published = true; },
  }), /SQLite unavailable/);
  assert.equal(published, false);
});

test('relevo de pending o autoridad durante guardado no publica ACK viejo', async () => {
  const target = ticket('target');
  let resolveSave!: () => void;
  const delayedSave = new Promise<void>(resolve => { resolveSave = resolve; });
  let current = true;
  let published = false;
  const operation = commitRetiredTableAccountAfterAck({
    expected: [target], acknowledged: [target], tableId: 'mesa-7', sourceId: 'source',
    assertCurrent: () => { if (!current) throw new Error('TABLE_ACCOUNT_RETIRE_SUPERSEDED'); },
    persist: async () => { await delayedSave; },
    publish: () => { published = true; },
  });
  current = false;
  resolveSave();
  await assert.rejects(operation, /SUPERSEDED/);
  assert.equal(published, false);
});

test('ACK por mesa conserva edición reciente de otra mesa y marcas wire del artículo transferido', async () => {
  const target = { ...ticket('target'), items: [{ id: 'water', cartId: 'moved', name: 'Agua', price: 100, quantity: 1, transferredFromTicketId: 'source' }] } as ParkedTicket;
  const wireAck = JSON.parse(JSON.stringify([target]));
  const unrelated = { ...ticket('unrelated'), tableId: 'mesa-8', name: 'Edición posterior' };
  const current = [ticket('source'), unrelated];
  let persisted: ParkedTicket[] = [];
  let published: ParkedTicket[] = [];
  const committed = await commitRetiredTableAccountAfterAck({
    expected: [target], acknowledged: wireAck, tableId: 'mesa-7', sourceId: 'source',
    current: () => current,
    persist: async rows => { persisted = rows; },
    publish: rows => { published = rows; },
  });
  assert.deepEqual(committed, [unrelated, target]);
  assert.deepEqual(persisted, committed);
  assert.deepEqual(published, committed);
  assert.equal(committed[1].items[0].transferredFromTicketId, 'source');
});

test('ACK tardío rebasa edición de otra mesa durante SQLite antes de publicar', async () => {
  const target = ticket('target');
  let current = [ticket('source'), { ...ticket('other'), tableId: 'mesa-8', name: 'Anterior' }];
  let resolveFirst!: () => void;
  const firstSave = new Promise<void>(resolve => { resolveFirst = resolve; });
  const saves: ParkedTicket[][] = [];
  let published: ParkedTicket[] = [];
  const operation = commitRetiredTableAccountAfterAck({
    expected: [target], acknowledged: [target], tableId: 'mesa-7', sourceId: 'source',
    current: () => current,
    persist: async rows => { saves.push(rows); if (saves.length === 1) await firstSave; },
    publish: rows => { published = rows; },
  });
  current = [ticket('source'), { ...ticket('other'), tableId: 'mesa-8', name: 'Nueva edición' }];
  resolveFirst();
  await operation;
  assert.equal(saves.length, 2);
  assert.equal(saves[1].find(row => row.id === 'other')?.name, 'Nueva edición');
  assert.equal(published.find(row => row.id === 'other')?.name, 'Nueva edición');
  assert.equal(published.some(row => row.id === 'source'), false);
});

test('wire Master/Cliente retira source de la mesa y preserva tercero y mesa unida', () => {
  const source = { ...ticket('source'), joinedTableIds: ['mesa-7', 'mesa-8'] };
  const target = { ...ticket('target'), joinedTableIds: ['mesa-7', 'mesa-8'] };
  const third = { ...ticket('third'), tableId: 'mesa-9' };
  const ack = mergeParkedTicketsForTable([source, third], [target], 'mesa-7');
  assert.deepEqual(ack.map(row => row.id), ['third', 'target']);
  assert.deepEqual(ack[1].joinedTableIds, ['mesa-7', 'mesa-8']);
});
