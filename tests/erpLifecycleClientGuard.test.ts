import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isPosMasterClientProfile, type SyncProfile } from '../services/sync/SyncProfile';

const clientProfile: SyncProfile = {
  contractedProduct: 'POS_ONLY',
  posRuntime: 'SLAVE',
  cloudChannel: 'POS_MASTER',
  dataMaster: 'POS_MASTER',
  cloudSyncEnabled: false,
  customerErpAccess: false,
  erpUiEnabled: false,
  masterUrl: 'http://10.0.0.129:3001',
  masterTerminalId: 'master-129',
};

test('client profiles never own ERP lifecycle, even before Master URL or with stale ERP fields', () => {
  assert.equal(isPosMasterClientProfile(clientProfile), true);
  assert.equal(isPosMasterClientProfile({ ...clientProfile, masterUrl: undefined, masterTerminalId: undefined }), true);
  assert.equal(isPosMasterClientProfile({
    ...clientProfile,
    erpBaseUrl: 'https://clic-erp.clicsuite.com',
    erpTerminalId: 'stale-erp-id',
  }), true);
});

test('Master ERP bootstrap and non-client profiles retain their lifecycle', () => {
  const masterErp: SyncProfile = {
    ...clientProfile,
    contractedProduct: 'POS_ERP',
    posRuntime: 'MASTER',
    cloudChannel: 'ERP_ACTIVE',
    dataMaster: 'ERP',
    erpBaseUrl: 'https://clic-erp.clicsuite.com',
    erpTerminalId: undefined,
  };
  assert.equal(isPosMasterClientProfile(masterErp), false);
  assert.equal(isPosMasterClientProfile({ ...masterErp, erpTerminalId: 'erp-master-129' }), false);
  assert.equal(isPosMasterClientProfile({
    ...clientProfile,
    posRuntime: 'MASTER',
    cloudChannel: 'POS_CLOUD_STAGING',
  }), false);
});

test('App bypasses ERP timers on clients while preserving endpoint publication', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, '../App.tsx'), 'utf8');
  const start = source.indexOf('  const erpLifecycleReady =');
  const end = source.indexOf('  // --- RECONNECTION BANNER ---', start);
  assert.ok(start >= 0 && end > start);
  const effect = source.slice(start, end);
  const guard = effect.indexOf('if (isPosMasterClientProfile())');
  assert.ok(guard > effect.indexOf('const publishEndpoint = async'));
  assert.match(effect.slice(guard, guard + 180), /void publishEndpoint\(\);[\s\S]*?return \(\) => \{ disposed = true; \};/);
  assert.ok(guard < effect.indexOf('createErpHeartbeatScheduler('));
  assert.ok(guard < effect.indexOf('syncTriggerCoordinator.configure('));
  assert.ok(guard < effect.indexOf('scheduleNextOutboxPoll('));
  assert.ok(guard < effect.indexOf('persistSetupErpBaseUrls('));
});
