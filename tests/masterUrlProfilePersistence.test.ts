import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  loadSyncProfile,
  resolveSyncTarget,
  saveSyncProfile,
  updateClientMasterUrl,
  type SyncProfile,
} from '../services/sync/SyncProfile';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const clientProfile: SyncProfile = {
  contractedProduct: 'POS_ONLY',
  posRuntime: 'SLAVE',
  cloudChannel: 'POS_MASTER',
  dataMaster: 'POS_MASTER',
  cloudSyncEnabled: false,
  customerErpAccess: false,
  erpUiEnabled: false,
  contractSource: 'BACKEND_REGISTER',
  masterUrl: 'http://10.0.0.101:3001',
  masterTerminalId: 'terminal-1',
  masterReady: true,
};

const withStorage = (run: (storage: MemoryStorage) => void): void => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    run(storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
};

test('changing a client Master IP updates the persisted sync target without changing pairing', () => {
  withStorage((storage) => {
    saveSyncProfile(clientProfile);
    storage.setItem('CLIC_POS_MASTER_URL', 'http://10.0.0.128:3001');
    storage.setItem('pos_master_ip', '10.0.0.128');
    storage.setItem('sales', '[{"id":"sale-1"}]');

    updateClientMasterUrl('http://10.0.0.128:3001/api/sync');

    const updated = loadSyncProfile();
    assert.equal(updated.masterUrl, 'http://10.0.0.128:3001');
    assert.equal(updated.masterTerminalId, clientProfile.masterTerminalId);
    assert.equal(updated.contractSource, clientProfile.contractSource);
    assert.equal(updated.masterReady, true);
    assert.equal(resolveSyncTarget(updated).baseUrl, 'http://10.0.0.128:3001/api/sync');
    assert.equal(storage.getItem('sales'), '[{"id":"sale-1"}]');
  });
});

test('changing a client URL never rewrites a Master profile', () => {
  withStorage(() => {
    saveSyncProfile({ ...clientProfile, posRuntime: 'MASTER', cloudChannel: 'NONE', masterUrl: undefined });
    updateClientMasterUrl('http://10.0.0.128:3001');
    assert.equal(loadSyncProfile().masterUrl, undefined);
  });
});

test('changing a Master URL does not rewrite an ERP profile', () => {
  withStorage(() => {
    saveSyncProfile({ ...clientProfile, contractedProduct: 'POS_ERP', posRuntime: 'LOCAL_SQLITE', cloudChannel: 'ERP_ACTIVE', masterUrl: undefined });
    updateClientMasterUrl('http://10.0.0.128:3001');
    assert.equal(loadSyncProfile().masterUrl, undefined);
  });
});

test('manual changes, recovery, and boot all reconcile the client sync profile', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, '../services/sync/SyncManager.ts'), 'utf8');
  const boot = source.slice(source.indexOf('async initialize(config:'), source.indexOf('private finalizeRecovery('));
  const recovery = source.slice(source.indexOf('private finalizeRecovery('), source.indexOf('async setMasterUrl('));
  const manual = source.slice(source.indexOf('async setMasterUrl('));

  assert.match(boot, /updateClientMasterUrl\(savedMasterUrl\)/);
  assert.match(recovery, /updateClientMasterUrl\(normalizedUrl\)/);
  assert.match(manual, /updateClientMasterUrl\(normalizedUrl\)/);
});
