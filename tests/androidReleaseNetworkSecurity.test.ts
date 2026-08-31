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
const releaseScript = await readFile(
    new URL('../scripts/release-android.sh', import.meta.url),
    'utf8',
);

test('release defaults to strict HTTPS with an explicit emergency LAN override', () => {
    assert.match(gradle, /clicPosAllowReleaseCleartext/);
    assert.match(gradle, /network_security_config_strict/);
    assert.match(manifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
    assert.match(strictConfig, /base-config cleartextTrafficPermitted="false"/);
});

test('release WebView follows the explicit LAN override while strict builds block mixed content', () => {
    assert.match(mainActivity, /ALLOW_CLEARTEXT_WEBVIEW/);
    assert.match(mainActivity, /MIXED_CONTENT_NEVER_ALLOW/);
    assert.match(mainActivity, /MIXED_CONTENT_ALWAYS_ALLOW/);
    assert.match(strictConfig, />localhost</);
    assert.match(strictConfig, />127\.0\.0\.1</);
});

test('canonical APK releases explicitly enable the Master/Cliente LAN transport', () => {
    assert.match(releaseScript, /CLIC_POS_RELEASE_LAN_HTTP_ENABLED:-true/);
    assert.match(
        releaseScript,
        /-PclicPosAllowReleaseCleartext=\$\{LAN_HTTP_ENABLED\}/,
    );
    assert.match(releaseScript, /lanHttpEnabled=\$\{LAN_HTTP_ENABLED\}/);
});

test('canonical release aborts when the binary manifest does not match the requested LAN policy', () => {
    assert.match(releaseScript, /verify_apk_network_policy/);
    assert.match(releaseScript, /dump xmltree "\$\{apk\}" AndroidManifest\.xml/);
    assert.match(releaseScript, /android:usesCleartextTraffic/);
    assert.match(releaseScript, /0xffffffff/);
    assert.match(releaseScript, /manifestNetworkPolicyVerified=true/);
    assert.ok(
        releaseScript.indexOf('verify_apk_network_policy "${AAPT}"')
        < releaseScript.indexOf('cp "${APK_SRC}" "${APK_DEST}"'),
        'la política debe validarse antes de publicar el APK canónico',
    );
});
