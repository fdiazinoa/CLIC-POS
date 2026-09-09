import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
const { syncManager } = await import('../services/sync/SyncManager');

test('Z transport failures reach the caller so the durable report stays retryable', async () => {
  const originalPush = apiSyncAdapter.pushZReport;
  apiSyncAdapter.pushZReport = async () => {
    throw new Error('network unavailable');
  };

  try {
    await assert.rejects(
      () => syncManager.pushZReport({ id: 'ZR-10', sequenceNumber: 'ZS001000010' }),
      /network unavailable/,
    );
  } finally {
    apiSyncAdapter.pushZReport = originalPush;
  }
});

test('an acknowledged retry completes without allocating a replacement report', async () => {
  const originalPush = apiSyncAdapter.pushZReport;
  let received: any = null;
  apiSyncAdapter.pushZReport = async (report: any) => {
    received = report;
  };

  const report = { id: 'ZR-10', sequenceNumber: 'ZS001000010' };
  try {
    await syncManager.pushZReport(report);
    assert.equal(received, report);
    assert.equal(received.id, 'ZR-10');
    assert.equal(received.sequenceNumber, 'ZS001000010');
  } finally {
    apiSyncAdapter.pushZReport = originalPush;
  }
});

test('background sync never requeues historical Z reports automatically', () => {
  const source = readFileSync(
    new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /recoverRecentZReportsForReplay/);
  assert.doesNotMatch(source, /sync_replay_recent_z_reports_v2_/);
});

test('production startup does not run bulk transaction or retained recovery', () => {
  const backgroundSource = readFileSync(
    new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url),
    'utf8',
  );
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const historySource = readFileSync(
    new URL('../components/ZReportHistory.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(backgroundSource, /recoverCompletedTransactionsForReplay/);
  assert.doesNotMatch(backgroundSource, /discoverPendingOperationsRecovery/);
  assert.doesNotMatch(backgroundSource, /pendingOperationsRecovery\.(sendPending|updateRetainedBackup)/);
  assert.doesNotMatch(appSource, /discoverPendingOperationsRecovery/);
  assert.doesNotMatch(appSource, /ZReportRecoveryService\.recoverOrphanedReports/);
  assert.doesNotMatch(historySource, /ZReportRecoveryService\.recoverOrphanedReports/);
});

test('Z history keeps an idempotent resend action for reports previously marked applied', () => {
  const source = readFileSync(
    new URL('../components/ZReportHistory.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /title="Enviar este mismo cierre al ERP de forma idempotente"/);
  assert.doesNotMatch(source, /r\.syncStatus !== 'APPLIED_ERP'.*handleSendZReport/s);
});

test('terminal or series rejections block the affected Z instead of retrying forever', () => {
  const source = readFileSync(
    new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /'z_sequence_series_forbidden'/);
  assert.match(source, /'z_sequence_scope_forbidden'/);
  assert.match(source, /'z_sequence_event_invalid'/);
});

test('blocked Z reports remain visible in the synchronization indicators', () => {
  const backgroundSource = readFileSync(
    new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url),
    'utf8',
  );
  const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');

  assert.match(backgroundSource, /blockedCount \+= data\.filter/);
  assert.match(backgroundSource, /'BLOCKED_FUNCTIONAL', 'ERROR', 'FAILED_FINAL'/);
  assert.match(posSource, /`Bloqueado · \$\{syncState\.blockedCount\}`/);
  assert.match(settingsSource, /documento\(s\) bloqueado\(s\)/);
});

test('synchronization monitor loads every collection counted as blocked', () => {
  const source = readFileSync(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');

  for (const collection of [
    'transactions',
    'inventoryLedger',
    'zReports',
    'cashMovements',
    'customerMutations',
    'posUserMutations',
    'wallet_transactions',
    'loyalty_events',
  ]) {
    assert.match(source, new RegExp(`db\\.get\\('${collection}'(?: as any)?\\)`));
  }

  assert.match(source, /formattedOperational/);
  assert.match(source, /\{item\.collection\}/);
  assert.match(source, /\{item\.error\}/);
});

test('manual Z retry preserves an identity conflict without sending or rewriting it', async () => {
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const { db } = await import('../utils/db');
  const get = db.getDocument, save = db.saveDocument, push = apiSyncAdapter.pushZReport;
  const report = { id: 'z-conflict', sequenceNumber: 'ZS001000010', syncStatus: 'BLOCKED_FUNCTIONAL', syncError: '409 Z_SEQUENCE_IDEMPOTENCY_CONFLICT' };
  db.getDocument = (async () => report) as any;
  db.saveDocument = async () => { assert.fail('must preserve the conflicting document'); };
  apiSyncAdapter.pushZReport = async () => { assert.fail('must not resend a known conflict'); };
  try {
    await assert.rejects(backgroundSyncManager.retryZReport(report.id), /conciliarse/);
  } finally {
    db.getDocument = get; db.saveDocument = save; apiSyncAdapter.pushZReport = push;
  }
});

test('manual retry sends only one Z and rejects concurrent sends while keeping its identity', async () => {
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const { db } = await import('../utils/db');
  const get = db.getDocument, all = db.get, save = db.saveDocument, push = apiSyncAdapter.pushZReport;
  const report = { id: 'z-selected', sequenceNumber: 'ZS001000002', syncStatus: 'ERROR' };
  let release!: () => void, started!: () => void;
  const sent = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let saved: any;
  db.getDocument = (async (_collection: string, id: string) => { assert.equal(id, report.id); return report; }) as any;
  db.get = (async () => { assert.fail('must not scan unrelated collections'); }) as any;
  db.saveDocument = async (collection: any, value: any) => { assert.equal(collection, 'zReports'); saved = value; };
  apiSyncAdapter.pushZReport = async value => { assert.equal(value, report); started(); await pending; };
  try {
    const retry = backgroundSyncManager.retryZReport(report.id);
    await sent;
    await assert.rejects(backgroundSyncManager.retryZReport('another-z'), /envío en curso/);
    release();
    await retry;
    assert.equal(saved.id, report.id);
    assert.equal(saved.sequenceNumber, report.sequenceNumber);
    assert.equal(saved.syncStatus, 'COMPLETED');
  } finally {
    release(); db.getDocument = get; db.get = all; db.saveDocument = save; apiSyncAdapter.pushZReport = push;
  }
});

test('new 409 rejection stays blocked with the original Z identity', async () => {
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const { db } = await import('../utils/db');
  const get = db.getDocument, save = db.saveDocument, push = apiSyncAdapter.pushZReport;
  const report = { id: 'z-rejected', sequenceNumber: 'ZS001000001', syncStatus: 'ERROR' };
  let saved: any;
  db.getDocument = (async () => report) as any;
  db.saveDocument = async (_collection: any, value: any) => { saved = value; };
  apiSyncAdapter.pushZReport = async () => { throw new Error('409 Z_SEQUENCE_IDEMPOTENCY_CONFLICT'); };
  try {
    await assert.rejects(backgroundSyncManager.retryZReport(report.id), /409/);
    assert.equal(saved.syncStatus, 'BLOCKED_FUNCTIONAL');
    assert.equal(saved.sequenceNumber, report.sequenceNumber);
    assert.equal(saved.id, report.id);
    assert.match(saved.syncError, /Z_SEQUENCE_IDEMPOTENCY_CONFLICT/);
  } finally {
    db.getDocument = get; db.saveDocument = save; apiSyncAdapter.pushZReport = push;
  }
});
