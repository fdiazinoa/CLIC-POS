import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transaction, ZReport } from '../types';
import {
  collectClosedTransactionIds,
  partitionTransactionsByClosedMembership,
  persistInboundTransactionsIfOpen,
} from '../services/sync/ClosedTransactionMembership';

const transaction = (id: string, total = 100): Transaction => ({
  id,
  displayId: id,
  terminalId: 'CAJA-01',
  date: '2026-09-08T14:00:00.000Z',
  items: [],
  payments: [],
  userId: 'U1',
  userName: 'Caja',
  status: 'COMPLETED',
  subtotal: total,
  tax: 0,
  total,
} as Transaction);

const report = (members: string[]): ZReport => ({
  id: 'ZR-1',
  terminalId: 'CAJA-01',
  sequenceNumber: 'ZS001000001',
  openedAt: '2026-09-08T13:00:00.000Z',
  closedAt: '2026-09-08T15:00:00.000Z',
  closedByUserId: 'U1',
  closedByUserName: 'Caja',
  baseCurrency: 'DOP',
  totalsByMethod: {},
  cashExpected: {},
  cashCounted: {},
  cashDiscrepancy: {},
  cashSales: 0,
  cashIn: 0,
  cashOut: 0,
  transactionCount: members.length,
  notes: '',
  recoveryMemberIds: { transactions: members, cashMovements: [], collections: [] },
});

test('a closed history row cannot become pending again while a new sale is preserved', () => {
  const replay = { ...transaction('TCKS001001252'), zReportId: undefined };
  const newSale = transaction('TCKS001001318');
  const history = [{ ...replay, zReportId: 'ZR-OLD' }];
  const closedIds = collectClosedTransactionIds(history, []);
  const result = partitionTransactionsByClosedMembership([replay, newSale], closedIds);

  assert.deepEqual(result.closed.map(item => item.id), ['TCKS001001252']);
  assert.deepEqual(result.open.map(item => item.id), ['TCKS001001318']);
});

test('the Z member manifest blocks a replay before transactionHistory archiving finishes', () => {
  const replay = transaction('TCKS001001317');
  const closedIds = collectClosedTransactionIds([], [report([replay.id])]);
  const result = partitionTransactionsByClosedMembership([replay], closedIds);

  assert.equal(result.open.length, 0);
  assert.deepEqual(result.closed.map(item => item.id), [replay.id]);
});

test('a close racing an inbound write removes only the replay and keeps legitimate pending sales', async () => {
  const replay = transaction('TCKS001001300', 250);
  const newSale = transaction('TCKS001001397', 175);
  const active = new Map<string, Transaction>();
  let membershipReads = 0;

  const result = await persistInboundTransactionsIfOpen([replay, newSale], {
    loadHistory: async () => [],
    loadReports: async () => {
      membershipReads += 1;
      return membershipReads === 1 ? [] : [report([replay.id])];
    },
    saveActive: async (item) => { active.set(item.id, item); },
    deleteActive: async (id) => { active.delete(id); },
  });

  assert.deepEqual(result.accepted.map(item => item.id), [newSale.id]);
  assert.deepEqual(result.skippedClosed.map(item => item.id), [replay.id]);
  assert.deepEqual([...active.keys()], [newSale.id]);
});

test('an already closed replay is acknowledged by the caller without being persisted active', async () => {
  const replay = transaction('TCKS001001252');
  const saved: string[] = [];
  const deleted: string[] = [];

  const result = await persistInboundTransactionsIfOpen([replay], {
    loadHistory: async () => [{ ...replay, zReportId: 'ZR-OLD' }],
    loadReports: async () => [],
    saveActive: async (item) => { saved.push(item.id); },
    deleteActive: async (id) => { deleted.push(id); },
  });

  assert.deepEqual(saved, []);
  assert.deepEqual(deleted, []);
  assert.deepEqual(result.skippedClosed.map(item => item.id), [replay.id]);
});

test('PANCUVI overlap fixture excludes 66 closed sales and preserves the 79 later sales', () => {
  const repeated = Array.from({ length: 66 }, (_, index) => {
    const number = 1252 + index;
    return transaction(`TCKS001${String(number).padStart(6, '0')}`, index === 65 ? 2451.10 : 400);
  });
  const legitimate = Array.from({ length: 79 }, (_, index) => {
    const number = 1318 + index;
    return transaction(`TCKS001${String(number).padStart(6, '0')}`, index === 78 ? 2933.07 : 200);
  });
  const history = repeated.map(item => ({ ...item, zReportId: 'ZR-2026-09-07' }));
  const result = partitionTransactionsByClosedMembership(
    [...repeated, ...legitimate],
    collectClosedTransactionIds(history, []),
  );
  const total = (items: Transaction[]) => Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));

  assert.equal(repeated.length + legitimate.length, 145);
  assert.equal(total([...repeated, ...legitimate]), 46984.17);
  assert.equal(result.closed.length, 66);
  assert.equal(total(result.closed), 28451.10);
  assert.equal(result.open.length, 79);
  assert.equal(total(result.open), 18533.07);
  assert.equal(result.open[0].id, 'TCKS001001318');
  assert.equal(result.open.at(-1)?.id, 'TCKS001001396');
});
