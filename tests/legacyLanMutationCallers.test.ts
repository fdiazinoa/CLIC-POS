import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));
const runtimeSources = (directory = root): string[] => readdirSync(directory).flatMap(name => {
  if (['.git', 'dist', 'node_modules', 'tests'].includes(name)) return [];
  const path = join(directory, name);
  if (statSync(path).isDirectory()) return runtimeSources(path);
  return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
});

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
      /(?:fetch|requestJson(?:<[^>]+>)?)\([\s\S]{0,600}?(?:resolveValidatedOperationalApiUrl|\/api\/(?:mesas|rooms|tables|config|customers|transactions\/split|audit|ordenes|cocina))[\s\S]{0,600}?method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/,
      `${path} still contains a direct mutating LAN request`,
    );
  }
  const pos = read('components/POSInterface.tsx');
  assert.doesNotMatch(pos, /postJsonWithTimeout|requestJson(?:<[^>]+>)?\s*\(/, 'POSInterface must not bypass the journal for KDS LAN mutations');
  for (const operation of ['KDS_ORDER_UPDATE_RETRY', 'KDS_ORDER_DISPATCH_RETRY', 'KDS_ORDER_UPDATE', 'KDS_ORDER_DISPATCH', 'KDS_ITEM_RETURN']) {
    assert.match(pos, new RegExp(`['"]${operation}['"]`));
  }
  const app = read('App.tsx');
  assert.match(app, /dispatchLegacyLanMutation<any>[\s\S]*PARKED_TICKETS_SYNC/);
  assert.match(app, /dispatchLegacyLanMutation<any>[\s\S]*FLOOR_PLAN_REPLACE/);
  assert.match(app, /dispatchLegacyLanMutation<any>[\s\S]*CUSTOMER_UPSERT/);
  assert.match(app, /operation:\s*'TABLE_OCCUPANCY_UPDATE',[\s\S]{0,160}?validateResponse:\s*validateLegacyTableStateResponse\(String\(table\.id\)\)/);
  assert.match(app, /operation:\s*'TABLE_RELEASE_STATE_UPDATE',[\s\S]{0,160}?validateResponse:\s*validateLegacyTableStateResponse\(String\(table\.id\)\)/);
  assert.match(read('components/POSInterface.tsx'), /operation:\s*'SPLIT_TRANSACTION'/);
  assert.match(read('components/UnitSelector.tsx'), /operation:\s*'CONFIG_UNIT_UPSERT'/);
  assert.match(read('components/InventoryAudit.tsx'), /operation:\s*'INVENTORY_AUDIT_COMMIT'/);
});

test('every direct legacy LAN dispatcher call declares an endpoint response validator', () => {
  const paths = [
    'App.tsx',
    'components/POSInterface.tsx',
    'components/TableMap.tsx',
    'components/UnitSelector.tsx',
    'components/InventoryAudit.tsx',
    'components/CustomerManagement.tsx',
    'components/SupplyChainManager.tsx',
  ];
  for (const path of paths) {
    const source = read(path);
    let cursor = 0;
    while ((cursor = source.indexOf('dispatchLegacyLanMutation<any>({', cursor)) >= 0) {
      const objectStart = source.indexOf('{', cursor);
      if (objectStart < 0) break;
      let depth = 0;
      let end = objectStart;
      for (; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1;
        if (source[end] === '}') depth -= 1;
        if (depth === 0) break;
      }
      const call = source.slice(objectStart, end + 1);
      assert.match(call, /validateResponse\s*:/, `${path} has a LAN mutation without a contractual validator`);
      cursor = end + 1;
    }
  }
});

test('requestJson and legacy POST helper inventory is exhaustive and classified', () => {
  const consumers = runtimeSources()
    .filter(path => /\brequestJson(?:<|\s*\()/.test(readFileSync(path, 'utf8')))
    .map(path => relative(root, path))
    .sort();
  assert.deepEqual(consumers, [
    'components/SyncErrorDiagnosticModal.tsx', // LAN_AUTH diagnostics only
    'components/TerminalSelector.tsx', // setup/auth contract, not operational mutation traffic
    'services/email/receiptEmailService.ts', // request type alias only
    'services/email/zReportEmailService.ts', // request type alias only
    'services/network/httpClient.ts', // transport definition
    'services/setup/erpTerminalSetup.ts', // ERP_CLOUD
    'services/setup/terminalDeviceRequests.ts', // LAN_AUTH / ERP auth request
    'services/sync/ApiSyncAdapter.ts', // centralized classified transport
    'services/sync/ConsignmentSyncService.ts', // ERP_CLOUD
    'services/sync/LegacyLanMutationTransport.ts', // LAN_LEGACY single journal gateway
  ]);
  for (const path of runtimeSources()) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /\bpostJsonWithTimeout\s*\(/, `${relative(root, path)} reintroduced an unjournaled POST helper`);
  }
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
