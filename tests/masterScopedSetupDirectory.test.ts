import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const refresh = native.slice(native.indexOf('private fun refreshSetupDirectory'), native.indexOf('private fun setupTenantId'));

test('activation reads the ERP directory with tenant, company and store filters', () => {
  assert.match(refresh, /"tenant_id" to tenantId, "company_id" to companyId, "store_id" to storeId/);
  assert.match(refresh, /api\/sync\/terminals\?\$query/);
  for (const key of ['tenant_id', 'company_id', 'store_id']) {
    assert.match(refresh, new RegExp(`record\\.optString\\("${key}"\\) !=`));
  }
  assert.match(refresh, /MASTER_SETUP_DIRECTORY_UNAVAILABLE/);
  assert.match(refresh, /throw IllegalStateException\("MASTER_SETUP_DIRECTORY_UNAVAILABLE/);
});

test('ERP roles replace stale roles and ORDER_TAKER must belong to this master', () => {
  assert.match(refresh, /record\.optString\("terminal_type"\)/);
  assert.match(refresh, /type == "ORDER_TAKER" && masterId\.isNotBlank\(\) && masterId != snapshot\.optString\("runtimeTerminalId"\)/);
  assert.match(refresh, /role\.put\("role", type\)/);
  assert.match(refresh, /\.put\("isPrimaryNode", id == snapshot\.optString\("runtimeTerminalId"\)\)/);
});

test('setup preserves local bindings and never changes the operational config or restaurant snapshot', () => {
  assert.match(refresh, /return applyPersistedBindings\(projectSetupDirectory\(snapshot, directory\), preserveRemoteBindings = true\)/);
  assert.doesNotMatch(refresh, /configSnapshot\s*=|persistTerminalBinding\(|updateRestaurantSnapshot\(/);
  assert.match(refresh, /if \(!context\.optBoolean\("erpEnabled", false\)\) return snapshot/);
  assert.match(native, /MASTER_SETUP_TENANT_MISMATCH/);
});

test('ERP occupancy cannot be replaced by a stale native binding or force-transfer', () => {
  assert.match(native, /preserveRemoteBindings && remoteDeviceId\.isNotBlank\(\) && remoteDeviceId != persistedDeviceId/);
  assert.match(native, /val forceTransfer = !erpManaged &&/);
  assert.match(native, /MASTER_SETUP_TERMINAL_NOT_BOUND/);
});

test('list, bind and initial-config each validate a fresh scoped roster without idle polling', () => {
  for (const method of ['buildTerminalListResponse', 'bindTerminal', 'buildInitialConfigResponse']) {
    assert.match(native, new RegExp(`private fun ${method}[^\\{]+\\{\\s*val setupSnapshot = refreshSetupDirectory\\(\\)`));
  }
  assert.match(app, /runtimeTerminalId: currentTerminal\.config\?\.erpTerminalId \|\| currentTerminal\.id/);
  assert.match(app, /masterSetupContext: \{\s*\.\.\.currentTerminal\.config\?\.erpBinding,\s*erpBaseUrl: resolveSetupErpBaseUrl\(\)/);
});
