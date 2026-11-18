import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatManualSyncFailure } from '../utils/manualSyncDiagnostic';
import { LargeMasterSyncV3Error } from '../services/sync/LargeMasterSyncV3Types';

const source = readFileSync(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('SyncSettings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.Expression | undefined;
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleSync') handler = node.initializer;
  ts.forEachChild(node, find);
}
find(parsed);
assert.ok(handler);

async function clickSync(stage: 'CONFIGURACION' | 'SINCRONIZAR_TODO' | 'MONITOR', error: unknown) {
  const feedback: { type: string; message: string }[] = [];
  const calls: string[] = [];
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const action = async (name: string) => { calls.push(name); if (name === stage) throw error; };
  const click = runInNewContext(ts.transpileModule(`(${handler!.getText(parsed)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    isSyncing: false,
    setIsSyncing: (value: boolean) => { if (!value) complete(); },
    setSyncFeedback: (value: { type: string; message: string } | null) => { if (value) feedback.push(value); },
    setLastSyncTime: () => {},
    waitForBackgroundSyncWindow: async () => {}, yieldBackgroundSyncChunk: async () => {},
    syncManager: { isUsingConfigPushV2Primary: () => stage !== 'CONFIGURACION', manualSyncAll: () => action('SINCRONIZAR_TODO') },
    syncTriggerCoordinator: { request: () => action('CONFIGURACION') },
    loadStatus: () => action('MONITOR'),
    formatManualSyncFailure, console: { error() {} },
  });
  click();
  await done;
  return { feedback: feedback.at(-1)!, calls };
}

test('actual sync button displays the exact V3 code and binding reason and exits busy state', async () => {
  const result = await clickSync('SINCRONIZAR_TODO', new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED', undefined, false, 'CONFIG_SCOPE'));
  assert.equal(result.feedback.type, 'error');
  assert.match(result.feedback.message, /Etapa: SINCRONIZAR_TODO/);
  assert.match(result.feedback.message, /Código: SYNC_V3_BINDING_CHANGED/);
  assert.match(result.feedback.message, /Motivo: CONFIG_SCOPE/);
  assert.deepEqual(result.calls, ['SINCRONIZAR_TODO']);
});

test('configuration and monitor failures identify the failing stage', async () => {
  for (const stage of ['CONFIGURACION', 'MONITOR'] as const) {
    const result = await clickSync(stage, Object.assign(new Error('HTTP_AUTH_ERROR'), { status: 401 }));
    assert.match(result.feedback.message, new RegExp(`Etapa: ${stage}`));
    assert.match(result.feedback.message, /Código: HTTP_AUTH_ERROR/);
    assert.match(result.feedback.message, /HTTP: 401/);
    assert.equal(result.calls.at(-1), stage);
  }
});

test('diagnostics never render raw credentials, URLs or server payloads', () => {
  const error = Object.assign(new TypeError('token=private-token https://erp.invalid/api?secret=private-secret'), {
    code: 'private-token', bindingReason: 'Bearer private-secret', payload: { token: 'private-token' },
    stack: 'TypeError: private-token\n at fn (https://localhost/assets/catalog-suite-ABC.js:12:345)',
  });
  const text = formatManualSyncFailure(error, 'SINCRONIZAR_TODO');
  assert.match(text, /ERROR_SIN_CODIGO/);
  assert.match(text, /Tipo: TypeError/);
  assert.match(text, /Origen: assets\/catalog-suite-ABC.js:12:345/);
  assert.doesNotMatch(text, /private|https:|Bearer/);
});

test('uncoded network failures and message-only codes remain actionable', () => {
  assert.match(formatManualSyncFailure(new TypeError('Failed to fetch'), 'SINCRONIZAR_TODO'), /Código: NETWORK_ERROR/);
  assert.match(formatManualSyncFailure(new Error('SYNC_V3_INVENTORY_COVERAGE_REQUIRED: sensitive detail'), 'SINCRONIZAR_TODO'), /Código: SYNC_V3_INVENTORY_COVERAGE_REQUIRED/);
  assert.doesNotMatch(formatManualSyncFailure(new Error('SYNC_V3_INVENTORY_COVERAGE_REQUIRED: sensitive detail'), 'SINCRONIZAR_TODO'), /sensitive/);
  assert.match(formatManualSyncFailure(null, 'ESPERA'), /ERROR_SIN_CODIGO/);
});


test('migration error renders exact changed fields and the blocking local reference',async()=>{
 const error=new LargeMasterSyncV3Error('SYNC_V3_BASELINE_MIGRATION_REQUIRED');
 error.baselineMigration={change:{dataset:'articles',recordId:'P',sku:'LGFR04',fromVersion:47,toVersion:102,
  fields:[{field:'trackInventory',before:'true',after:'false'}]},
  reference:{collection:'transactions',documentId:'SALE-KEEP',path:'$["items"][0].v3SaleAuthority',kind:'RETAINED_SOURCE'}};
 const result=await clickSync('SINCRONIZAR_TODO',error);
 assert.match(result.feedback.message,/LGFR04.*47 → 102/);
 assert.match(result.feedback.message,/trackInventory: true → false/);
 assert.match(result.feedback.message,/transactions \/ SALE-KEEP/);
 assert.ok(result.feedback.message.includes('$["items"][0].v3SaleAuthority'));
 assert.match(result.feedback.message,/Migración no ejecutada/);
});
