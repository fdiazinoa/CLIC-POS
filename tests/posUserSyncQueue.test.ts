import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { User } from '../types';
import {
  buildPosUserMutationPayload,
  posUserMutationFingerprint,
} from '../services/sync/PosUserSyncQueue';

const apiSource = readFileSync(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
const backgroundSource = readFileSync(new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url), 'utf8');

test('la mutación POS incluye identidad operativa pero nunca biometría', () => {
  const user: User = {
    id: 'felix-local',
    name: 'Felix',
    pin: '2468',
    role: 'CASHIER',
    roleId: 'CASHIER',
    syncSource: 'LOCAL',
    biometrics: {
      credentialID: 'reader-template',
      publicKey: 'device-only-secret',
      registeredAt: '2026-08-26T00:00:00.000Z',
    },
  };

  const payload = buildPosUserMutationPayload(user, 'terminal-2');
  assert.deepEqual(payload, {
    sourceUserId: 'felix-local',
    name: 'Felix',
    pin: '2468',
    role: 'CASHIER',
    terminalScope: 'SELECTED',
    terminalIds: ['terminal-2'],
    isActive: true,
  });
  assert.equal('biometrics' in payload, false);
  assert.doesNotMatch(JSON.stringify(payload), /reader-template|device-only-secret/);
});

test('la huella no altera la identidad idempotente de la mutación', () => {
  const first = buildPosUserMutationPayload({
    id: 'felix-local', name: 'Felix', pin: '2468', role: 'CASHIER',
  }, 'terminal-2');
  const second = buildPosUserMutationPayload({
    id: 'felix-local', name: 'Felix', pin: '2468', role: 'CASHIER',
    biometrics: { credentialID: 'bio', publicKey: 'local', registeredAt: 'now' },
  }, 'terminal-2');

  assert.equal(
    posUserMutationFingerprint('UPSERT', 'felix-local', first),
    posUserMutationFingerprint('UPSERT', 'felix-local', second),
  );
});

test('el worker conserva y reintenta mutaciones hasta confirmación ERP', () => {
  assert.match(apiSource, /postOperationalPayload\('\/pos-users\/mutations'/);
  assert.match(apiSource, /POS_USER_ACK_MISSING/);
  assert.match(backgroundSource, /processCollection<any>\('posUserMutations'/);
  assert.match(backgroundSource, /collectionErrors\.push\(`posUserMutations:/);
});
