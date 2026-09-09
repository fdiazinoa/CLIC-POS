import assert from 'node:assert/strict';
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
