import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v3RefundAnchor } from '../services/sync/LargeMasterSyncV3StockAuthority';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const session = () => source('services/sync/LargeMasterSyncV3OperationalSession.ts');
const commit = () => source('services/sync/LargeMasterSyncV3FinancialCommit.ts');

/**
 * A credit note reverses a document that was already issued. These guards keep the reversal
 * anchored on the ticket's own snapshot: no catalog negotiation, no master drift blocking.
 */

const stamp = (extra: Record<string, unknown> = {}) => ({
  binding: '["t","term","dev","https://erp/api/sync","https://erp"]',
  syncId: 'aaaaaaaa-0000-4000-8000-000000000007', syncVersion: 7,
  inventoryVersion: 42, inventoryCursor: 'cursor-42', tariffId: 'tar-1', warehouseId: 'wh-1',
  taxIncluded: false, ...extra,
} as any);

test('the reversal anchor is the ticket inventory, not the live one', () => {
  const anchor = v3RefundAnchor(stamp());
  assert.deepEqual(anchor, { syncId: 'aaaaaaaa-0000-4000-8000-000000000007', syncVersion: 7,
    version: 42, cursor: 'cursor-42', contractVersion: 2 });
  // A distinct inventory generation stays distinct: the reversal never borrows today's cursor.
  const other = v3RefundAnchor(stamp({ inventoryVersion: 90, inventoryCursor: 'cursor-90' }));
  assert.equal(other.version, 90);
  assert.equal(other.cursor, 'cursor-90');
});

test('an explicit inventory sync id wins over the catalog stamp', () => {
  const anchor = v3RefundAnchor(stamp({ inventorySyncId: 'bbbbbbbb-0000-4000-8000-000000000001',
    inventorySyncVersion: 3 }));
  assert.equal(anchor.syncId, 'bbbbbbbb-0000-4000-8000-000000000001');
  assert.equal(anchor.syncVersion, 3);
});

test('a malformed explicit inventory authority is rejected, never silently ignored', () => {
  assert.throws(() => v3RefundAnchor(stamp({ inventorySyncId: 'bbbbbbbb-0000-4000-8000-000000000001' })),
    /SYNC_V3_STOCK_AUTHORITY_INVALID/);
  assert.throws(() => v3RefundAnchor(stamp({ inventorySyncVersion: 3 })), /SYNC_V3_STOCK_AUTHORITY_INVALID/);
});

test('validate only demands a live baseline for sales', () => {
  const src = session();
  assert.match(src, /const refund = intent === 'REFUND';/);
  // The live-baseline comparison is inside a `!refund` guard.
  assert.match(src, /!refund && \(authority\.inventoryVersion !== this\.ready\.inventoryVersion/);
  assert.match(src, /const anchor = refund \? v3RefundAnchor\(authority!\) :/);
  // The ticket's own generation must still classify its tax, or the source is corrupt.
  assert.match(src, /if \(old\.length !== 1\) throw new LargeMasterSyncV3Error\('SYNC_V3_RETAINED_TAX_CLASSIFICATION_CHANGED'\)/);
  // Drift is a notice for a reversal and a hard stop for anything else.
  assert.match(src, /if \(!refund\) throw new LargeMasterSyncV3Error\('SYNC_V3_RETAINED_TAX_CLASSIFICATION_CHANGED'\)/);
  assert.match(src, /onTaxClassificationChanged\?\.\(\{ taxId: id, before: v3TaxSemantics\(old\[0\]\)/);
});

test('the reversal path never negotiates a master', () => {
  // A dedicated accessor that opens cached-only and ignores refresh requests.
  assert.match(session(), /getLargeMasterSyncV3RetainedSession = createLargeMasterSyncV3SessionCoordinator\(\n  \(_refresh, metric\) => LargeMasterSyncV3OperationalSession\.open\(false, metric, true\)/);
  const app = source('App.tsx');
  // The credit-note gate uses the retained session and never the refresh-capable one.
  const gate = app.slice(app.indexOf('let refundConfig = config;'), app.indexOf('// 1. Calculations'));
  assert.match(gate, /getLargeMasterSyncV3RetainedSession\(\)/);
  assert.doesNotMatch(gate, /getLargeMasterSyncV3OperationalSession\(\)/);
  assert.match(gate, /refundClassificationNotices\.push\(notice\)/);
});

test('a reversal-only batch posts locally while a sale batch keeps live authority', () => {
  const src = commit();
  assert.match(src, /const reversalOnly = entries\.every\(entry => entry\.options\?\.refund === true\);/);
  assert.match(src, /await \(reversalOnly \? getLargeMasterSyncV3RetainedSession\(\) : getLargeMasterSyncV3OperationalSession\(\)\)/);
  // Refund replay reads the document it is replaying, never a fresh catalog.
  assert.match(src, /export const readV3CommittedRefundReplay[\s\S]{0,400}?getLargeMasterSyncV3RetainedSession\(\);await session\.assertCurrent\(\)/);
});

test('the tax drift travels with the credit note as evidence', () => {
  const app = source('App.tsx');
  assert.match(app, /metadata: \{ v3TaxClassificationNotice: refundClassificationNotices \}/);
  assert.match(app, /import type \{ V3TaxClassificationNotice \}/);
});
