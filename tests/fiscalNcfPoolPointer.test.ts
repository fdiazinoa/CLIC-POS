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
  config?: any[];
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
    ['config', structuredClone(fixture.config || [])],
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

test('global legacy range cannot authorize a terminal without its own assignment', async () => {
  await withFiscalCollections({
    fiscalRanges: [{
      id: 'legacy-range', type: 'B02', prefix: 'B02', startNumber: 1,
      endNumber: 5_000, currentGlobal: 4_200, expiryDate: '2027-12-31', isActive: true,
    }],
  }, async ({ collection, historyReads }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(historyReads(), 0, 'legacy pool issuance must not rescan historical tickets');
    assert.equal(collection('fiscalRanges')[0].currentGlobal, 4_200);
    assert.deepEqual(collection('localFiscalBuffer'), []);
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
  assert.equal((checkoutSource.match(/await db\.getNextNCF\(/g) || []).length, 2);
});


test('managed terminal cannot consume global B04 when only B02 is assigned', async () => {
  await withFiscalCollections({
    fiscalRanges: [{ id: 'b04-global', type: 'B04', prefix: 'B04', startNumber: 1, endNumber: 100, currentGlobal: 2, isActive: true }],
    fiscalAllocations: [{ id: 'a-b02', terminalId, ncfType: 'B02', reservedStart: 10, reservedEnd: 20, nextNumber: 10, status: 'ACTIVE' }],
  }, async ({ collection }) => {
    const before = ['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection);
    assert.equal(await db.canRequestMoreNCF('B04', terminalId), false);
    assert.equal(await db.requestFiscalBatch(terminalId, 'B04', 1), null);
    assert.equal(await db.getNextNCF('B04', terminalId), null);
    assert.deepEqual(['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection), before);
  });
});

test('explicit empty authority and disabled terminal never fall back to global pool', async () => {
  await withFiscalCollections({ fiscalRanges: [{ id: 'global', type: 'B04', prefix: 'B04', startNumber: 1, endNumber: 100, currentGlobal: 2, isActive: true }] }, async ({ collection }) => {
    for (const fiscal of [{ fiscalAllocations: [] }, { enabled: false }]) {
      const context = { erpTerminalId: terminalId, fiscal } as any;
      assert.equal(await db.canRequestMoreNCF('B04', terminalId, context), false);
      assert.equal(await db.getNextNCF('B04', terminalId, 1, context), null);
    }
    assert.equal(collection('fiscalRanges')[0].currentGlobal, 2);
  });
});

test('canonical ERP identity emits assigned B04 and prepared reservation preserves authority', async () => {
  await withFiscalCollections({ fiscalRanges: [{ id: 'range-b04', type: 'B04', prefix: 'B04', startNumber: 4001, endNumber: 4002, expiryDate: '2027-12-31', isActive: true }], fiscalAllocations: [{ id: 'a-b04', terminalId, fiscalRangeId: 'range-b04', ncfType: 'B04', prefix: 'B04', reservedStart: 4001, reservedEnd: 4002, nextNumber: 4001, status: 'ACTIVE' }] }, async ({ collection }) => {
    const context = { erpTerminalId: terminalId, fiscal: { enabled: true } } as any;
    assert.equal(await db.getNextNCF('B04', terminalId, 1, context), 'B0400004001');
    assert.equal(await db.getNextNCF('B04', terminalId, 1, context), 'B0400004002');
    assert.equal(await db.validatePreparedFiscalAuthority('B04', terminalId, 'B0400004002', context), true);
    assert.equal(await db.validatePreparedFiscalAuthority('B04', terminalId, 'B0400004003', context), false);
    assert.equal(collection('fiscalAllocations')[0].nextNumber, 4003);
  });
});


test('matching managed buffer cannot issue from a removed, inactive, wrong-type or changed-prefix lot', async () => {
  const validRange = { id: 'assigned-lot', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 100, currentGlobal: 2, isActive: true };
  for (const ranges of [[], [{ ...validRange, isActive: false }], [{ ...validRange, type: 'B04' }], [{ ...validRange, prefix: 'WRONG' }]]) {
    await withFiscalCollections({
      fiscalRanges: ranges,
      fiscalAllocations: [{ id: 'allocation', terminalId, fiscalRangeId: 'assigned-lot', ncfType: 'B02', prefix: 'B02', reservedStart: 10, reservedEnd: 20, nextNumber: 10, status: 'ACTIVE' }],
      localFiscalBuffer: [{ id: 'B02', type: 'B02', terminalId, allocationId: 'allocation', fiscalRangeId: 'assigned-lot', prefix: 'B02', startNumber: 10, currentNumber: 10, endNumber: 10 }],
    }, async ({ collection }) => {
      const before = ['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection);
      const originalSave = dbAdapter.saveCollection;
      let writes = 0;
      try {
        dbAdapter.saveCollection = async (...args) => { writes++; return originalSave.apply(dbAdapter, args); };
        assert.equal(await db.canRequestMoreNCF('B02', terminalId), false);
        assert.equal(await db.validatePreparedFiscalAuthority('B02', terminalId, 'B0200000010'), false);
        assert.equal(await db.getNextNCF('B02', terminalId), null);
        assert.equal(await db.requestFiscalBatch(terminalId, 'B02', 1), null);
        assert.equal(writes, 0);
        assert.deepEqual(['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection), before);
      } finally { dbAdapter.saveCollection = originalSave; }
    });
  }
});


test('checkout rejects recovered-reservation returns and invalid credit before any fiscal reservation', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const refundReservation = source.indexOf('reservedRefundNcf = await db.getNextNCF');
  const saleReservation = source.indexOf('finalNcf = await db.getNextNCF');
  const reservationRejection = source.indexOf('if (activeRecoveredReservation && hasReturns)');
  const creditRejection = source.indexOf("if (creditGate && !hasCreditOverrideApproval)");
  assert.ok(reservationRejection > 0 && reservationRejection < refundReservation && reservationRejection < saleReservation);
  assert.ok(creditRejection > 0 && creditRejection < refundReservation && creditRejection < saleReservation);
});

const authorizedRange = { id: 'strict-lot', type: 'B02', prefix: 'B02', startNumber: 100, endNumber: 200,
  currentGlobal: 99, expiryDate: '2099-12-31', isActive: true };
const authorizedAllocation = { id: 'strict-allocation', terminalId, fiscalRangeId: 'strict-lot', ncfType: 'B02',
  reservedStart: 100, reservedEnd: 110, nextNumber: 100, status: 'ACTIVE' };

for (const [label, patch] of Object.entries({
  'missing identity': { terminalId: '' }, 'foreign terminal': { terminalId: 'other-terminal' },
  'missing allocation id': { id: '' }, 'missing lot': { fiscalRangeId: '' },
  'unknown lot': { fiscalRangeId: 'foreign-lot' }, 'unknown status': { status: 'UNKNOWN' },
  'legacy status': { status: 'LEGACY' }, 'paused status': { status: 'PAUSED' },
  'released status': { status: 'RELEASED' }, 'revoked timestamp': { releasedAt: '2026-01-01' },
  'missing fiscal type': { ncfType: '' }, 'invalid pointer': { nextNumber: 0 },
  'fractional pointer': { nextNumber: 100.5 }, 'NaN pointer': { nextNumber: 'bad' },
  'pointer past bound': { nextNumber: 112 }, 'start outside lot': { reservedStart: 99, nextNumber: 100 },
  'end outside lot': { reservedEnd: 201 },
  'foreign source provenance': { metadata: { sourceTerminalId: 'other-terminal' } },
  'foreign company provenance': { metadata: { companyId: 'other-company' } },
})) {
  test(`strict authority blocks ${label} without writes or historical reads`, async () => {
    await withFiscalCollections({ fiscalRanges: [authorizedRange], fiscalAllocations: [{ ...authorizedAllocation, ...patch }] }, async ({ collection, historyReads }) => {
      const before = ['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection);
      assert.equal(await db.canRequestMoreNCF('B02', terminalId), false);
      assert.equal(await db.getNextNCF('B02', terminalId), null);
      assert.equal(await db.requestFiscalBatch(terminalId, 'B02', 100), null);
      assert.equal(await db.validatePreparedFiscalAuthority('B02', terminalId, 'B0200000100'), false);
      assert.deepEqual(['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection), before);
      assert.equal(historyReads(), 0);
    });
  });
}
for (const [label, patch] of Object.entries({ 'inactive': { isActive: false }, 'expired': { expiryDate: '2000-01-01' },
  'missing expiry': { expiryDate: '' }, 'invalid date': { expiryDate: '2099-02-30' }, 'invalid lot bound': { startNumber: 100.5 },
  'foreign prefix': { prefix: 'B04' } })) {
  test(`strict authority blocks ${label} lot`, async () => {
    await withFiscalCollections({ fiscalRanges: [{ ...authorizedRange, ...patch }], fiscalAllocations: [authorizedAllocation] }, async ({ collection }) => {
      const before = ['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection);
      assert.equal(await db.canRequestMoreNCF('B02', terminalId), false);
      assert.equal(await db.getNextNCF('B02', terminalId), null);
      assert.equal(await db.validatePreparedFiscalAuthority('B02', terminalId, 'B0200000100'), false);
      assert.deepEqual(['fiscalRanges', 'fiscalAllocations', 'localFiscalBuffer'].map(collection), before);
    });
  });
}
test('missing caller identity cannot borrow any assigned terminal or buffer', async () => {
  await withFiscalCollections({ fiscalRanges: [authorizedRange], fiscalAllocations: [authorizedAllocation],
    localFiscalBuffer: [{ type: 'B02', prefix: 'B02', currentNumber: 100, endNumber: 100 }] }, async () => {
    assert.equal(await db.canRequestMoreNCF('B02'), false);
    assert.equal(await db.getNextNCF('B02', ''), null);
    assert.equal(await db.getNextNCF('B02', 'foreign', 1, { erpTerminalId: terminalId } as any), null);
  });
});
test('explicit revocation persists across reads and cannot be restored by a global lot or historical ticket', async () => {
  await withFiscalCollections({ fiscalRanges: [authorizedRange], fiscalAllocations: [authorizedAllocation] }, async ({ collection }) => {
    assert.equal(await db.getNextNCF('B02', terminalId), 'B0200000100');
    assert.equal(await db.validatePreparedFiscalAuthority('B02', terminalId, 'B0200000100'), true);
    await db.rehydrateOperationalDocumentState([], [], [], terminalId);
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(await db.validatePreparedFiscalAuthority('B02', terminalId, 'B0200000100'), false);
    await assert.rejects(db.reconcilePreparedNCF('B02', terminalId, 'B0200000100'), /FISCAL_TERMINAL_AUTHORITY_REQUIRED/);
    assert.deepEqual(collection('fiscalAllocations'), []);
    assert.deepEqual(collection('localFiscalBuffer'), []);
  });
});
test('direct simultaneous batch requests reserve different consecutive numbers', async () => {
  await withFiscalCollections({ fiscalRanges: [authorizedRange], fiscalAllocations: [authorizedAllocation] }, async () => {
    const [a, b] = await Promise.all([db.requestFiscalBatch(terminalId, 'B02', 100), db.requestFiscalBatch(terminalId, 'B02', 100)]);
    assert.equal(a?.currentNumber, 100); assert.equal(b?.currentNumber, 101);
  });
});
test('company-scoped assigned lot works only for the current persisted terminal company', async () => {
  await withFiscalCollections({ fiscalRanges: [authorizedRange], fiscalAllocations: [{ ...authorizedAllocation, metadata: { companyId: 'company-a' } }],
    config: [{ terminals: [{ id: 'local-terminal', config: { erpTerminalId: terminalId, erpBinding: { companyId: 'company-a' }, fiscal: { enabled: true } } }] }] }, async () => {
    assert.equal(await db.getNextNCF('B02', 'local-terminal'), 'B0200000100');
    assert.equal(await db.getNextNCF('B02', 'other-terminal', 1, { erpTerminalId: terminalId } as any), null);
  });
});

test('persisted explicit assignment revocation blocks stale DB authority even before collection rehydration', async () => {
  await withFiscalCollections({ fiscalRanges: [authorizedRange], fiscalAllocations: [authorizedAllocation],
    config: [{ terminals: [{ id: terminalId, config: { erpTerminalId: terminalId,
      fiscal: { enabled: true, fiscalAllocations: [], fiscalRanges: [authorizedRange] } } }] }] }, async () => {
    assert.equal(await db.canRequestMoreNCF('B02', terminalId), false);
    assert.equal(await db.getNextNCF('B02', terminalId), null);
    assert.equal(await db.requestFiscalBatch(terminalId, 'B02', 1), null);
    assert.equal(await db.validatePreparedFiscalAuthority('B02', terminalId, 'B0200000100'), false);
  });
});
