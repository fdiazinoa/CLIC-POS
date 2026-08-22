import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const strictConfig = await readFile(
    new URL('../android/app/src/main/res/xml/network_security_config_strict.xml', import.meta.url),
    'utf8',
);
const mainActivity = await readFile(
    new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
    'utf8',
);

test('release defaults to strict HTTPS with an explicit emergency LAN override', () => {
    assert.match(gradle, /clicPosAllowReleaseCleartext/);
    assert.match(gradle, /network_security_config_strict/);
    assert.match(manifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
    assert.match(strictConfig, /base-config cleartextTrafficPermitted="false"/);
});

test('release WebView blocks mixed content while local middleware remains scoped', () => {
    assert.match(mainActivity, /MIXED_CONTENT_NEVER_ALLOW/);
    assert.doesNotMatch(mainActivity, /MIXED_CONTENT_ALWAYS_ALLOW/);
    assert.match(strictConfig, />localhost</);
    assert.match(strictConfig, />127\.0\.0\.1</);
});
