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
