import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractErpRegisterAuth, resolveNormalizedRegisterDeviceToken } from '../services/sync/erpRegisterResponse';
import { forwardedSetupCredentialSource, isolateCandidateSetupConfig,
  resolveSetupRegisterCredentials } from '../services/sync/LargeMasterSyncV3SetupCredentials';

const hostile = () => ({ deviceToken: 'download-device', syncToken: 'download-sync',
  terminal_config: { config: { device_token: 'download-nested', auth: { activationToken: 'download-activation' } },
    metadata: { auth: { deviceToken: 'download-auth' }, syncAuth: { syncToken: 'download-metadata-sync' } } },
  config: { metadata: { syncAuth: { deviceToken: 'download-config-device' } } },
});

test('selector candidate omitted bind credentials fails before callback/persistence despite downloaded nested tokens', () => {
  let replacements = 0;
  const bind = { success: true, terminal_id: 'bound' };
  const snapshot = hostile();
  const original = structuredClone(snapshot);
  assert.throws(() => {
    const result = resolveSetupRegisterCredentials(true, bind, snapshot, snapshot.terminal_config);
    if (result.normalizedDeviceToken || result.registerAuth.syncToken) replacements++;
  }, { message: 'DEVICE_TOKEN_MISSING_FROM_REGISTER' });
  assert.equal(replacements, 0);
  assert.deepEqual(snapshot, original);
});

test('selector accepts root or nested authorized bind tokens only, preserving every authorized credential value', () => {
  for (const bind of [{ deviceToken: 'bind-device', syncToken: 'bind-sync', tokenExpiresAt: 'future' },
    { auth: { deviceToken: 'bind-device', syncToken: 'bind-sync', tokenExpiresAt: 'future' } },
    { metadata: { syncAuth: { deviceToken: 'bind-device', syncToken: 'bind-sync' } } }]) {
    const result = resolveSetupRegisterCredentials(true, bind, hostile());
    assert.equal(result.normalizedDeviceToken, 'bind-device');
    assert.equal(result.registerAuth.syncToken, 'bind-sync');
  }
});

test('App candidate reads explicit forwarded fields only; context/download metadata cannot supply missing authority', () => {
  const context = { ...hostile(), deviceToken: undefined, syncToken: undefined,
    boundConfig: { metadata: { syncAuth: { deviceToken: 'download-bound', syncToken: 'download-bound-sync' } } },
    profile: { activationToken: 'download-profile' }, initialConfigData: hostile() };
  let replacements = 0;
  assert.throws(() => {
    const result = resolveSetupRegisterCredentials(true, forwardedSetupCredentialSource(context),
      context.initialConfigData, context.boundConfig.metadata, context.profile);
    if (result.normalizedDeviceToken || result.registerAuth.syncToken) replacements++;
  }, { message: 'DEVICE_TOKEN_MISSING_FROM_REGISTER' });
  assert.equal(replacements, 0);
  const result = resolveSetupRegisterCredentials(true, forwardedSetupCredentialSource({ ...context,
    deviceToken: 'forwarded-bind-device', syncToken: 'forwarded-bind-sync' }), context.initialConfigData);
  assert.equal(result.normalizedDeviceToken, 'forwarded-bind-device');
  assert.equal(result.registerAuth.syncToken, 'forwarded-bind-sync');
});

test('candidate config/snapshot isolation removes known POS auth carriers without stripping fiscal/payment secrets', () => {
  const provider = { apiKey: 'provider-api-key', syncToken: 'provider-integration-token', auth: { deviceToken: 'provider-token' } };
  const config = { ...hostile(), metadata: { auth: { deviceToken: 'bad', permission: 'keep' },
    syncAuth: { device_token: 'bad', sync_token: 'bad', tokenSource: 'bad' } },
    terminals: [{ config: { erpSnapshot: hostile().terminal_config, deviceToken: 'bad' } }],
    terminalSnapshots: { bound: hostile().terminal_config }, fiscal: { provider }, paymentProviders: { provider } };
  const original = structuredClone(config);
  const isolated = isolateCandidateSetupConfig(config);
  assert.deepEqual(config, original);
  assert.equal(extractErpRegisterAuth(isolated, isolated.metadata, isolated.metadata.syncAuth).deviceToken, undefined);
  assert.equal(extractErpRegisterAuth(isolated, isolated.metadata, isolated.metadata.syncAuth).syncToken, undefined);
  assert.deepEqual(isolated.metadata.auth, { permission: 'keep' });
  assert.deepEqual(isolated.metadata.syncAuth, {});
  assert.equal(isolated.terminals[0].config.deviceToken, undefined);
  assert.equal(extractErpRegisterAuth(isolated.terminals[0].config.erpSnapshot).deviceToken, undefined);
  assert.equal(extractErpRegisterAuth(isolated.terminalSnapshots.bound).deviceToken, undefined);
  assert.deepEqual(isolated.fiscal.provider, provider);
  assert.deepEqual(isolated.paymentProviders.provider, provider);
});

test('flag OFF preserves legacy snapshot fallback extraction exactly', () => {
  const bind = { success: true };
  const download = hostile();
  const sources = [bind, download, download.terminal_config];
  const oldAuth = extractErpRegisterAuth(...sources);
  const oldDevice = resolveNormalizedRegisterDeviceToken(bind, download, oldAuth);
  const result = resolveSetupRegisterCredentials(false, ...sources as [unknown, ...unknown[]]);
  assert.deepEqual(result.registerAuth, oldAuth);
  assert.equal(result.normalizedDeviceToken, oldDevice);
  assert.equal(result.normalizedDeviceToken, 'download-device');
});

test('real selector/App/setup call sites use the shared authority boundary', () => {
  const selector = readFileSync(new URL('../components/TerminalSelector.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const setup = readFileSync(new URL('../services/setup/erpTerminalSetup.ts', import.meta.url), 'utf8');
  assert.match(selector, /resolveSetupRegisterCredentials\(candidateV3,\s*data, initialConfigData/);
  assert.match(app, /candidateV3Setup \? forwardedSetupCredentialSource\(setupResult\) : setupResult/);
  assert.match(app, /boundConfig: isolateCandidateSetupConfig\(incomingSetup.boundConfig\)/);
  assert.match(setup, /assertLargeMasterSyncV3Bootstrap\(payload[^;]+;\s*payload = isolateCandidateSetupConfig\(payload\)/);
});
