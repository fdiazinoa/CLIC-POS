import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const credentialStoreSource = fs.readFileSync(
  path.join(repoRoot, 'services/sync/TerminalCredentialStore.ts'),
  'utf8',
);
const appSource = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');

test('persists the complete client binding in native Preferences for APK upgrades', () => {
  assert.match(credentialStoreSource, /masterIp\?: string \| null/);
  assert.match(credentialStoreSource, /masterUrl\?: string \| null/);
  assert.match(credentialStoreSource, /setupMode\?: string \| null/);
  assert.match(credentialStoreSource, /syncMode\?: string \| null/);
  assert.match(credentialStoreSource, /configSnapshot\?: BusinessConfig \| null/);
  assert.match(credentialStoreSource, /Preferences\.set\(\{ key: CREDENTIALS_KEY/);
});

test('restores client network and configuration mirrors before boot pairing checks', () => {
  assert.match(credentialStoreSource, /storage\.setItem\('pos_master_ip', credentials\.masterIp\)/);
  assert.match(credentialStoreSource, /storage\.setItem\('CLIC_POS_MASTER_URL', credentials\.masterUrl\)/);
  assert.match(credentialStoreSource, /storage\.setItem\('initial_terminal_config', JSON\.stringify\(credentials\.configSnapshot\)\)/);
  assert.match(credentialStoreSource, /if \(!raw\) return null/);

  const credentialReadIndex = appSource.indexOf('await readTerminalCredentials()');
  const pairingCheckIndex = appSource.indexOf('let masterIp = localStorage.getItem');
  assert.ok(credentialReadIndex >= 0);
  assert.ok(pairingCheckIndex > credentialReadIndex);
});

test('refreshes the native recovery payload whenever terminal config is persisted', () => {
  const persistFunctionStart = appSource.indexOf('const persistInitialTerminalConfig');
  const persistFunctionEnd = appSource.indexOf('const restorePersistentOperationalIdentity');
  const persistFunctionSource = appSource.slice(persistFunctionStart, persistFunctionEnd);

  assert.match(persistFunctionSource, /buildInitialTerminalConfigSnapshot\(config\)/);
  assert.match(persistFunctionSource, /saveTerminalCredentialsSync\(\{/);
  assert.match(persistFunctionSource, /masterIp: localStorage\.getItem\('pos_master_ip'\)/);
  assert.match(persistFunctionSource, /configSnapshot: recoverySnapshot/);
});

test('checkpoints an existing paired terminal on the first healthy boot after upgrading', () => {
  assert.match(
    appSource,
    /if \(localPairedTerminal && currentConfig && !Array\.isArray\(currentConfig\)\) \{\s*persistInitialTerminalConfig\(currentConfig\)/,
  );
  assert.match(appSource, /terminal_upgrade_recovery_checkpoint_refreshed/);
});
