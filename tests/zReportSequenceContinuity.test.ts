import test from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentSeries, ZReport } from '../types';
import {
  requireErpZSequenceAuthority,
  resolveZSequenceContinuity,
} from '../services/zreports/ZReportSequenceContinuity';
import {
  mergeDocumentSeriesCollection,
  mergeIncomingDocumentSeriesWithoutRewind,
} from '../utils/documentSeriesIdentity';

const terminalId = 'terminal-a';
const series = (overrides: Partial<DocumentSeries & Record<string, unknown>> = {}) => ({
  id: 'series-z',
  documentType: 'Z_REPORT',
  name: 'Cierre Z',
  description: '',
  prefix: 'ZS001',
  nextNumber: 1,
  padding: 6,
  source: 'ERP_TERMINAL_CONFIG',
  ...overrides,
} as DocumentSeries & Record<string, unknown>);
const report = (id: string, sequenceNumber: string, overrides: Partial<ZReport> = {}) => ({
  id,
  terminalId,
  sequenceNumber,
  openedAt: '2026-09-08T08:00:00.000Z',
  closedAt: '2026-09-08T09:00:00.000Z',
  closedByUserId: 'user-a',
  closedByUserName: 'Cashier',
  totalSales: 0,
  totalTransactions: 0,
  totalTax: 0,
  totalDiscount: 0,
  paymentTotals: {},
  cashMovements: { cashIn: 0, cashOut: 0 },
  cashExpected: 0,
  cashCounted: 0,
  cashDifference: 0,
  ...overrides,
} as ZReport);

test('uses the persisted reports as a lower bound without renumbering them', () => {
  const evidence = resolveZSequenceContinuity({
    series: series({ sequenceRevision: '9', lastCommittedNumber: 9 }),
    reports: [report('z-009', 'ZS001000009', { seriesId: 'series-z', seriesNumber: 9 })],
    terminalIds: [terminalId],
  });
  assert.equal(evidence.selectedNumber, 10);
  assert.equal(evidence.localHighWatermark, 9);
  assert.deepEqual(evidence.localReportIds, ['z-009']);
});

test('a repeated visible code remains occupied even if seriesId changed', () => {
  const evidence = resolveZSequenceContinuity({
    series: series({ sequenceRevision: '10', lastCommittedNumber: 9 }),
    reports: [report('legacy-z-009', 'ZS001000009', { seriesId: 'old-series-z', seriesNumber: 9 })],
    terminalIds: [terminalId],
  });
  assert.equal(evidence.selectedNumber, 10);
});

test('ignores reports from another terminal', () => {
  const evidence = resolveZSequenceContinuity({
    series: series({ sequenceRevision: '0' }),
    reports: [report('other-z', 'ZS001000099', { terminalId: 'terminal-b' })],
    terminalIds: [terminalId],
  });
  assert.equal(evidence.selectedNumber, 1);
});

test('blocks the reproduced post-reset payload that only returns nextNumber=1', () => {
  const configured = series();
  const evidence = resolveZSequenceContinuity({
    series: configured,
    reports: [],
    terminalIds: [terminalId],
  });
  assert.throws(
    () => requireErpZSequenceAuthority(configured, evidence),
    /Z_SEQUENCE_AUTHORITY_REQUIRED/,
  );
});

test('accepts an authenticated ERP high-water mark and selects its next number', () => {
  const configured = series({
    nextNumber: 10,
    sequenceRevision: '12',
    lastCommittedNumber: 9,
  });
  const evidence = resolveZSequenceContinuity({
    series: configured,
    reports: [],
    terminalIds: [terminalId],
  });
  requireErpZSequenceAuthority(configured, evidence);
  assert.equal(evidence.selectedNumber, 10);
  assert.equal(evidence.erpRevision, '12');
  assert.equal(evidence.erpHighWatermark, 9);
});

test('accepts explicit zero authority for a genuinely unused ERP series', () => {
  const configured = series({
    nextNumber: 1,
    sequenceRevision: '0',
    lastCommittedNumber: 0,
  });
  const evidence = resolveZSequenceContinuity({
    series: configured,
    reports: [],
    terminalIds: [terminalId],
  });
  requireErpZSequenceAuthority(configured, evidence);
  assert.equal(evidence.selectedNumber, 1);
  assert.equal(evidence.erpHighWatermark, 0);
});

test('rejects an ERP next number that does not exceed its own high-water mark', () => {
  const configured = series({
    nextNumber: 9,
    sequenceRevision: '12',
    lastCommittedNumber: 9,
  });
  const evidence = resolveZSequenceContinuity({
    series: configured,
    reports: [],
    terminalIds: [terminalId],
  });
  assert.throws(
    () => requireErpZSequenceAuthority(configured, evidence),
    /Z_SEQUENCE_AUTHORITY_STALE/,
  );
});

test('catalog/config merging cannot rewind ERP sequence evidence', () => {
  const [merged] = mergeDocumentSeriesCollection([
    series({ nextNumber: 10, sequenceRevision: 12, lastCommittedNumber: 9 }),
    series({ nextNumber: 1, sequenceRevision: 0, lastCommittedNumber: 0 }),
  ]);
  assert.equal(merged.nextNumber, 10);
  assert.equal(merged.sequenceRevision, 12);
  assert.equal(merged.lastCommittedNumber, 9);
});

test('an authoritative full snapshot can remove old series without rewinding the assigned one', () => {
  const merged = mergeIncomingDocumentSeriesWithoutRewind(
    [
      series({ nextNumber: 10, sequenceRevision: 12, lastCommittedNumber: 9 }),
      series({ id: 'obsolete', prefix: 'OLDZ', nextNumber: 4 }),
    ],
    [series({ nextNumber: 1, sequenceRevision: 0, lastCommittedNumber: 0 })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].nextNumber, 10);
  assert.equal(merged[0].sequenceRevision, 12);
  assert.equal(merged[0].lastCommittedNumber, 9);
});
