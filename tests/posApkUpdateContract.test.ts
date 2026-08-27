import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  isRemotePosApkNewer,
  resolvePosApkLatestUrl,
  resolvePosApkPortalUrl,
} from '../services/version/posApkUpdateService';

const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('detecta una versión APK remota únicamente cuando su versionCode es mayor', () => {
  assert.equal(isRemotePosApkNewer(1198, 1199), true);
  assert.equal(isRemotePosApkNewer(1198, 1198), false);
  assert.equal(isRemotePosApkNewer(1198, 1197), false);
});

test('usa las rutas canónicas de Cloud Admin sin depender del redirect legado', () => {
  assert.equal(resolvePosApkLatestUrl(), 'https://cloud-admin.clicsuite.com/api/pos-apk/latest');
  assert.equal(resolvePosApkPortalUrl(), 'https://cloud-admin.clicsuite.com/apk-pos');
});

test('el chequeo automático espera seguridad y no descarta el resultado por cambios de config', () => {
  assert.match(appSource, /!isDataLoaded \|\| !isSecurityLoaded \|\| posApkUpdateCheckStartedRef\.current/);
  assert.doesNotMatch(appSource, /if \(disposed \|\| !result\?\.hasUpdate\) return/);
  assert.match(appSource, /setPosApkUpdate\(result\)/);
});
