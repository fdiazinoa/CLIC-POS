import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const syncSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const nativeServerSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);
const kdsSource = readFileSync(new URL('../components/kds/KitchenDisplay.tsx', import.meta.url), 'utf8');

test('un snapshot de usuarios limitado por terminal no elimina usuarios ERP ausentes', () => {
  assert.match(syncSource, /const isTerminalScopedSnapshot = terminalIds\.some/);
  assert.match(syncSource, /const canReplaceSnapshotSet = replaceSnapshotSet && !isTerminalScopedSnapshot/);
  assert.match(syncSource, /explicitlyRemovedIds\.has\(user\.id\)/);
  assert.match(syncSource, /terminal_scoped_snapshot_applied/);
  assert.doesNotMatch(syncSource, /canOperatePos === false \|\| !this\.terminalScopeMatches/);
  assert.match(syncSource, /El padrón de credenciales POS debe estar disponible offline/);
});

test('la unión conserva la mesa origen como cuenta principal y un solo ticket', () => {
  assert.match(tableMapSource, /tableId: mode === 'MERGE' \? sourceTable\.id : targetTable\.id/);
  assert.match(tableMapSource, /primaryTableId: sourceTable\.id/);
  assert.match(tableMapSource, /currentOrderTotal: mode === 'MERGE' \? undefined : nextTotal/);
  assert.match(tableMapSource, /resolveOperationalApiUrl\('\/api\/mesas\/unir'\)/);
  assert.match(tableMapSource, /diagnosticContext: \{ operation: 'TABLE_MERGE' \}/);
  assert.match(nativeServerSource, /val affectedTableIds = mutableSetOf\(tableId\)/);
  assert.match(nativeServerSource, /affectedTableIds\.none/);
  assert.match(tableMapSource, /<Link2 size=\{15\} strokeWidth=\{3\}/);
  assert.doesNotMatch(tableMapSource, /Unida a \{model\.joinedPrimaryLabel\}/);
  assert.doesNotMatch(tableMapSource, /'Cuenta compartida'/);
});

test('el KDS usa cuadrícula responsive con desplazamiento vertical', () => {
  assert.match(kdsSource, /overflow-y-auto overflow-x-hidden/);
  assert.match(kdsSource, /sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4/);
  assert.match(kdsSource, /h-\[calc\(\(100vh-9\.5rem\)\/2\)\]/);
  assert.doesNotMatch(kdsSource, /<div className="flex h-full gap-6">/);
});
