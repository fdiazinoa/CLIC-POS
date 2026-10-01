import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dbAdapter } from '../services/db';
import { db } from '../utils/db';
import type { FiscalAllocation } from '../types';

const terminalId = 'terminal-fiscal-qa';
const nonFiscalTickets = Array.from({ length: 6_000 }, (_, index) => ({
  id: `ticket-sin-comprobante-${index + 1}`,
  ncf: null,
  ncfType: null,
}));

type FiscalFixture = {
  fiscalRanges: Record<string, unknown>[];
  fiscalAllocations?: object[];
  localFiscalBuffer?: Record<string, unknown>[];
};

const withFiscalCollections = async (
  fixture: FiscalFixture,
  verify: (state: {
    collection: (key: string) => any[];
    historyReads: () => number;
  }) => Promise<void>,
) => {
  const originalGet = dbAdapter.getCollection;
  const originalSave = dbAdapter.saveCollection;
  const collections = new Map<string, any[]>([
    ['fiscalRanges', structuredClone(fixture.fiscalRanges)],
    ['fiscalAllocations', structuredClone(fixture.fiscalAllocations || [])],
    ['localFiscalBuffer', structuredClone(fixture.localFiscalBuffer || [])],
    ['transactions', nonFiscalTickets],
    ['transactionHistory', []],
  ]);
  let historyReadCount = 0;

  try {
    (dbAdapter as any).getCollection = async (key: string) => {
      if (key === 'transactions' || key === 'transactionHistory') historyReadCount++;
      return structuredClone(collections.get(key) || []);
    };
    (dbAdapter as any).saveCollection = async (key: string, value: any[]) => {
      collections.set(key, structuredClone(value));
    };
    await verify({
      collection: (key) => structuredClone(collections.get(key) || []),
      historyReads: () => historyReadCount,
    });
  } finally {
    dbAdapter.getCollection = originalGet;
    dbAdapter.saveCollection = originalSave;
  }
};

test('terminal allocation emits first and second B02 consecutively without scanning 6,000 non-fiscal tickets', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_000, expiryDate: '2027-12-31', isActive: true,
    }],
    fiscalAllocations: [{
      id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
      reservedStart: 4_001, reservedEnd: 4_100, nextNumber: 4_001,
      status: 'ACTIVE', releasedAt: null,
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200004001');
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200004002');
    assert.equal(historyReads(), 0, 'normal issuance must use the persisted fiscal pointer, not full ticket collections');
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4_003);
    assert.equal(collection('localFiscalBuffer')[0].currentNumber, 4_003);
    assert.equal(collection('transactions').length, 6_000);
  });
});

test('legacy range without terminal allocation uses its persisted currentGlobal pointer for consecutive NCFs', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'legacy-range', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_200, expiryDate: '2027-12-31', isActive: true,
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200004201');
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200004202');
    assert.equal(historyReads(), 0, 'legacy pool issuance must not rescan historical tickets');
    assert.equal(collection('fiscalRanges')[0].currentGlobal, 4_202);
    assert.equal(collection('localFiscalBuffer')[0].currentNumber, 4_203);
  });
});

test('stale local buffer cannot rewind an authoritative terminal allocation pointer', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_000, expiryDate: '2027-12-31', isActive: true,
    }],
    fiscalAllocations: [{
      id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
      reservedStart: 4_001, reservedEnd: 4_100, nextNumber: 4_010,
      status: 'ACTIVE', releasedAt: null,
    }],
    localFiscalBuffer: [{
      id: 'B02', type: 'B02', prefix: 'B02', currentNumber: 4_002,
      endNumber: 4_002, startNumber: 4_002, expiryDate: '2027-12-31',
      terminalId, fiscalRangeId: 'range-b02', allocationId: 'allocation-b02',
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200004010');
    assert.equal(historyReads(), 0);
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4_011);
  });
});

test('exhausted terminal allocation fails closed without consulting sales history', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 5_000, expiryDate: '2027-12-31', isActive: true,
    }],
    fiscalAllocations: [{
      id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
      reservedStart: 4_900, reservedEnd: 5_000, nextNumber: 5_001,
      status: 'EXHAUSTED', releasedAt: null,
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(historyReads(), 0);
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 5_001);
  });
});

test('exhausted legacy range fails closed without consulting sales history', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'legacy-range', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 5_000, expiryDate: '2027-12-31', isActive: true,
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(historyReads(), 0);
    assert.equal(collection('fiscalRanges')[0].currentGlobal, 5_000);
  });
});

test('released terminal allocation cannot fall back to an otherwise active legacy range', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_499, expiryDate: '2027-12-31', isActive: true,
    }],
    fiscalAllocations: [{
      id: 'released-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
      reservedStart: 4_500, reservedEnd: 4_600, nextNumber: 4_500,
      status: 'RELEASED', releasedAt: '2026-10-01T12:00:00.000Z',
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(historyReads(), 0);
    assert.equal(collection('fiscalRanges')[0].currentGlobal, 4_499);
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4_500);
  });
});

test('missing or malformed allocation pointer fails closed instead of restarting its range', async () => {
  for (const invalidPointer of [undefined, 'not-a-number', 0, 4_500.5]) {
    await withFiscalCollections({
      fiscalRanges: [{
        id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
        endNumber: 5_000, currentGlobal: 4_499, expiryDate: '2027-12-31', isActive: true,
      }],
      fiscalAllocations: [{
        id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
        reservedStart: 4_500, reservedEnd: 4_600, nextNumber: invalidPointer,
        status: 'ACTIVE', releasedAt: null,
      }],
    }, async ({ collection, historyReads }) => {
      assert.equal(await db.getNextNCF('B02', terminalId), null, `invalid pointer ${String(invalidPointer)} must block issuance`);
      assert.equal(historyReads(), 0);
      assert.equal(collection('fiscalRanges')[0].currentGlobal, 4_499);
      assert.equal(collection('fiscalAllocations')[0].nextNumber, invalidPointer);
    });
  }
});

test('two simultaneous requests for the same terminal and type cannot issue the same NCF', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_300, expiryDate: '2027-12-31', isActive: true,
    }],
    fiscalAllocations: [{
      id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
      reservedStart: 4_301, reservedEnd: 4_400, nextNumber: 4_301,
      status: 'ACTIVE', releasedAt: null,
    }],
  }, async ({ collection, historyReads }) => {
    const results = await Promise.all([
      db.getNextNCF('B02', terminalId),
      db.getNextNCF('B02', terminalId),
    ]);
    assert.deepEqual(results.sort(), ['B0200004301', 'B0200004302']);
    assert.equal(historyReads(), 0);
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4_303);
  });
});

test('simultaneous B01 and B02 issuance preserves both allocation pointers', async () => {
  await withFiscalCollections({
    fiscalRanges: [
      { id: 'range-b01', type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 5_000, currentGlobal: 1_000, expiryDate: '2027-12-31', isActive: true },
      { id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 5_000, currentGlobal: 2_000, expiryDate: '2027-12-31', isActive: true },
    ],
    fiscalAllocations: [
      { id: 'allocation-b01', terminalId, fiscalRangeId: 'range-b01', ncfType: 'B01', reservedStart: 1_001, reservedEnd: 1_100, nextNumber: 1_001, status: 'ACTIVE', releasedAt: null },
      { id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02', reservedStart: 2_001, reservedEnd: 2_100, nextNumber: 2_001, status: 'ACTIVE', releasedAt: null },
    ],
  }, async ({ collection, historyReads }) => {
    const [b01, b02] = await Promise.all([
      db.getNextNCF('B01', terminalId),
      db.getNextNCF('B02', terminalId),
    ]);
    assert.equal(b01, 'B0100001001');
    assert.equal(b02, 'B0200002001');
    assert.equal(historyReads(), 0);
    const pointers = new Map(collection('fiscalAllocations').map((allocation) => [allocation.ncfType, allocation.nextNumber]));
    assert.equal(pointers.get('B01'), 1_002);
    assert.equal(pointers.get('B02'), 2_002);
  });
});

test('rehydrating a stale ERP pointer cannot rewind the same allocation', async () => {
  const currentAllocation: FiscalAllocation = {
    id: 'allocation-b02', terminalId, fiscalRangeId: 'range-b02', ncfType: 'B02',
    reservedStart: 4_701, reservedEnd: 4_900, nextNumber: 4_801,
    status: 'ACTIVE', releasedAt: null,
  };
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'range-b02', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_700, expiryDate: '2027-12-31', isActive: true,
    }],
    fiscalAllocations: [currentAllocation],
  }, async ({ collection, historyReads }) => {
    await db.rehydrateOperationalDocumentState([], [], [{ ...currentAllocation, nextNumber: 4_750 }], terminalId);
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4_801);
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200004801');
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4_802);
    assert.equal(historyReads(), 0);
  });
});

test('checkout does not abandon an in-flight NCF reservation with an eight-second timeout', () => {
  const checkoutSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(checkoutSource, /TIMEOUT_GET_NCF/);
  assert.doesNotMatch(checkoutSource, /withTimeout\s*\(\s*db\.getNextNCF/);
  assert.equal((checkoutSource.match(/await db\.getNextNCF\(/g) || []).length, 3);
});
