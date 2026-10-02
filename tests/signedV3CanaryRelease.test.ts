import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scriptPath = new URL('../scripts/release-android.sh', import.meta.url);
const script = readFileSync(scriptPath, 'utf8');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');

const runPolicy = (canary: string, optIn: string, extra: Record<string, string> = {}) => spawnSync(
  'bash', [scriptPath.pathname, 'HEAD'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_LARGE_MASTER_SYNC_V3_CANARY: canary,
      CLIC_POS_SIGNED_V3_CANARY: optIn,
      ...extra,
    },
  },
);

test('signed release rejects a canary without the second explicit opt-in before git or Gradle', () => {
  const result = runPolicy('true', 'false');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requiere VITE_LARGE_MASTER_SYNC_V3_CANARY=true y CLIC_POS_SIGNED_V3_CANARY=true/);
  assert.doesNotMatch(result.stdout, /Fuente del release|Ejecutando .*Gradle/);
});

test('signed release rejects a stray opt-in or ambiguous canary flag', () => {
  assert.equal(runPolicy('false', 'true').status, 1);
  assert.match(runPolicy('yes', 'true').stderr, /deben ser true o false/);
  assert.match(runPolicy('true', 'true', { CLIC_POS_DIAGNOSTICS: 'true' }).stderr,
    /no puede combinarse con otros modos diagnósticos/);
});

test('Gradle independently enforces signed canary identity and labels the release variant', () => {
  assert.match(gradle, /v3Canary != signedV3CanaryOptIn/);
  assert.match(gradle, /if \(v3Canary && signedV3CanaryOptIn\) versionNameSuffix '-canary'/);
  assert.match(gradle, /if \(v3Canary && \(diagnosticBuild \|\| webviewProfileQa \|\| tableLatencyQa\)\)/);
  assert.match(script, /ARTIFACT_VERSION_NAME="\$\{VERSION_NAME\}-canary"/);
  assert.match(script, /ACTUAL_VERSION_NAME.*extract_version_name_from_metadata/);
  assert.match(script, /ACTUAL_VERSION_NAME.*NEXT_VERSION_CODE.*ARTIFACT_VERSION_NAME/);
  assert.match(script, /signedV3Canary=\$\{V3_CANARY_ENABLED\}/);
  assert.match(script, /canaryNonPromotable=\$\{V3_CANARY_ENABLED\}/);
  assert.match(script, /salesEnabled=.*V3_CANARY_ENABLED/);
  assert.match(script, /promotionGatePassed=false/);
});

test('next normal version advances after a signed canary metadata version', () => {
  const start = script.indexOf('if [[ "${SOURCE_VERSION_CODE}" == "${NEXT_VERSION_CODE}"');
  const end = script.indexOf('ARTIFACT_VERSION_NAME="${VERSION_NAME}"', start);
  assert.ok(start > 0 && end > start);
  const versionLogic = script.slice(start, end);
  const result = spawnSync('bash', ['-c', `${versionLogic}\nprintf '%s' "$VERSION_NAME"`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SOURCE_VERSION_CODE: '1426',
      SOURCE_VERSION_NAME: '1.1.426',
      NEXT_VERSION_CODE: '1452',
      LATEST_RELEASE_VERSION_NAME: '1.1.451-canary',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.1.452');
});

test('ordinary release keeps its unmodified version name and report marks canary off', () => {
  const start = script.indexOf('ARTIFACT_VERSION_NAME="${VERSION_NAME}"');
  const end = script.indexOf('info "Fuente del release:', start);
  assert.ok(start > 0 && end > start);
  const artifactLogic = script.slice(start, end);
  const run = (canary: string) => spawnSync('bash', ['-c', `${artifactLogic}\nprintf '%s' "$ARTIFACT_VERSION_NAME"`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VERSION_NAME: '1.1.452',
      V3_CANARY_ENABLED: canary,
      CLIC_POS_DIAGNOSTICS: 'false',
      CLIC_POS_WEBVIEW_PROFILE: 'false',
    },
  });
  assert.equal(run('false').stdout, '1.1.452');
  assert.equal(run('true').stdout, '1.1.452-canary');
});
