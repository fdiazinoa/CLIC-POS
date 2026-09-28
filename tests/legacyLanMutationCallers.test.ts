import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('restaurant Master mutations use the journaled LAN dispatcher', () => {
  for (const path of [
    'App.tsx',
    'components/POSInterface.tsx',
    'components/TableMap.tsx',
    'components/UnitSelector.tsx',
    'components/InventoryAudit.tsx',
    'components/CustomerManagement.tsx',
    'components/SupplyChainManager.tsx',
  ]) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /fetch\(await resolveValidatedOperationalApiUrl\([\s\S]{0,240}?method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/,
      `${path} still contains a direct mutating fetch to the validated Master`,
    );
  }
  const app = read('App.tsx');
  assert.match(app, /dispatchLegacyLanMutation<any>[\s\S]*PARKED_TICKETS_SYNC/);
  assert.match(app, /dispatchLegacyLanMutation<any>[\s\S]*FLOOR_PLAN_REPLACE/);
  assert.match(app, /dispatchLegacyLanMutation<any>[\s\S]*CUSTOMER_UPSERT/);
  assert.match(read('components/POSInterface.tsx'), /operation:\s*'SPLIT_TRANSACTION'/);
  assert.match(read('components/UnitSelector.tsx'), /operation:\s*'CONFIG_UNIT_UPSERT'/);
  assert.match(read('components/InventoryAudit.tsx'), /operation:\s*'INVENTORY_AUDIT_COMMIT'/);
});

test('ApiSyncAdapter validates provisional payloads without schema-level journal closure', () => {
  const source = read('services/sync/ApiSyncAdapter.ts');
  const schemaHelper = source.match(/private async acknowledgeLegacyJsonResponse[\s\S]*?\n {4}}\n\n {4}private async acknowledgeLegacy401/)?.[0] || '';
  assert.match(schemaHelper, /attachLegacyResponseReceipt/);
  assert.doesNotMatch(schemaHelper, /mutationJournal\.acknowledge/);
});

test('legacy NetworkAdapter mutations fail closed instead of bypassing the journal', () => {
  const source = read('services/db/adapters/NetworkAdapter.ts');
  for (const method of ['saveCollection', 'saveDocument', 'bulkUpsert', 'bulkUpdateProducts', 'deleteDocument']) {
    assert.match(source, new RegExp(`async ${method}[\\s\\S]{0,220}?rejectUnjournaledMutation`));
  }
});

test('deprecated NetworkSyncService mutations fail closed instead of bypassing the journal', () => {
  const source = read('services/sync/NetworkSyncService.ts');
  for (const method of ['pushPendingTransactions', 'pushPendingInventory', 'pushCollection']) {
    assert.match(source, new RegExp(`${method}\\([^)]*\\)[^{]*\\{[\\s\\S]{0,180}?rejectUnjournaledLegacyMutation`));
  }
});
