// Build-only resolver/verifier. Never imported by the POS runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function resolveDiagnosticMode(env = process.env) {
  const flag = (name, fallback = false) => {
    if (env[name] === undefined) return fallback;
    if (!['true', 'false'].includes(env[name])) throw Error(`${name} must be true or false`);
    return env[name] === 'true';
  };
  const broad = flag('CLIC_POS_DIAGNOSTICS');
  const focused = flag('CLIC_POS_SCANNER_FOCUS_DIAGNOSTICS');
  const native = flag('CLIC_POS_NATIVE_DIAGNOSTICS', broad);
  if (broad && focused || (broad || focused) && !native) throw Error('Incompatible CLIC-POS diagnostic flags');
  const mode = focused ? 'focused-control' : broad ? 'broad' : native ? 'native-control' : 'normal';
  const diagnostic = mode !== 'normal';
  return { broad, focused, native, mode, diagnostic, instrumented: diagnostic, temporary: diagnostic,
    releaseEligible: false, promotionGatePassed: false };
}

function files(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error('Symlink asset rejected');
    const name = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? files(root, name) : [name];
  });
}
export function verifyExecutableAssets(entries, mode) {
  const executable = entries.filter(([name]) => /\.(?:m?js)$/.test(name));
  if (!executable.length) throw Error('Executable assets missing');
  const focused = executable.some(([, bytes]) => bytes.toString().includes('__CLIC_POS_SCANNER_FOCUS__'));
  const broad = executable.some(([, bytes]) => bytes.toString().includes('__POS_DIAGNOSTICS__'));
  const zone = executable.some(([name, bytes]) => /(?:^|\/)zone[.-]/i.test(name) || /__Zone_symbol_prefix|__zone_symbol__/.test(bytes.toString()));
  if (focused !== mode.focused || broad !== mode.broad || zone !== mode.broad) throw Error('Executable diagnostic assets mismatch');
  return { focusedApiPresent: focused, broadApiPresent: broad, zoneBootstrapPresent: zone, executableAssets: executable.length };
}
export function verifyWebAssets(root, mode, apk) {
  const dist = path.join(root, 'dist');
  const packaged = path.join(root, 'android/app/src/main/assets/public');
  const names = files(dist);
  if (!names.length) throw Error('dist is empty');
  // Capacitor CLI removeCordovaJS generates these empty compatibility stubs.
  // They contain no executable code; never allow a plugin or stale nonempty file.
  const emptyCapacitorStubs = files(packaged).filter(name => !names.includes(name) && ['cordova.js', 'cordova_plugins.js'].includes(name));
  for (const name of emptyCapacitorStubs) if (fs.statSync(path.join(packaged, name)).size !== 0) throw Error('Nonempty generated Cordova stub rejected');
  const hashes = {};
  const entries = names.map(name => {
    const bytes = fs.readFileSync(path.join(dist, name));
    if (!bytes.equals(fs.readFileSync(path.join(packaged, name)))) throw Error(`Copied asset mismatch: ${name}`);
    hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
    return [name, bytes];
  });
  for (const name of emptyCapacitorStubs) {
    hashes[name] = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    entries.push([name, Buffer.alloc(0)]);
  }
  const expectedExecutables = entries.map(([name]) => name).filter(name => /\.(?:m?js)$/.test(name)).sort();
  if (JSON.stringify(files(packaged).filter(name => /\.(?:m?js)$/.test(name)).sort()) !== JSON.stringify(expectedExecutables)) throw Error('Extra copied executable assets');
  const checks = verifyExecutableAssets(entries, mode);
  if (apk) {
    const prefix = 'assets/public/';
    const apkNames = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
    const actualExecutables = apkNames.filter(name => name.startsWith(prefix) && /\.(?:m?js)$/.test(name)).map(name => name.slice(prefix.length)).sort();
    if (JSON.stringify(actualExecutables) !== JSON.stringify(expectedExecutables)) throw Error('Stale/extra APK executable assets');
    const extracted = entries.map(([name, bytes]) => {
      if (apkNames.filter(item => item === prefix + name).length !== 1) throw Error('APK asset missing or duplicated');
      const actual = execFileSync('unzip', ['-p', apk, prefix + name], { maxBuffer: 32 * 1024 * 1024 });
      if (!bytes.equals(actual)) throw Error(`APK asset mismatch: ${name}`);
      return [name, actual];
    });
    verifyExecutableAssets(extracted, mode);
  }
  return { assetsVerified: true, apkAssetsVerified: Boolean(apk), emptyCapacitorStubs, ...checks, hashes };
}
export function verifyNativeArtifact(root, apk, aapt, mode, code, name) {
  const generated = fs.readFileSync(path.join(root, 'android/app/build/generated/source/buildConfig/release/com/clicpos/app/BuildConfig.java'), 'utf8');
  if (!new RegExp(`boolean POS_DIAGNOSTICS = ${mode.native};`).test(generated) || !/boolean DEBUG = false;/.test(generated)) throw Error('Generated release native flags mismatch');
  const manifest = execFileSync(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8' });
  const profileable = manifest.match(/E: profileable[^\n]*\n(?:[^\n]*\n)*?[^\n]*android:shell[^\n]*/)?.[0];
  if (!profileable || !profileable.includes(mode.native ? '0xffffffff' : '(type 0x12)0x0')) throw Error('Packaged profileable mismatch');
  if (/android:debuggable[^\n]*0xffffffff/.test(manifest)) throw Error('Debuggable APK rejected');
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' });
  const pkg = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
  if (!pkg || pkg[1] !== 'com.clicpos.app' || pkg[2] !== String(code) || pkg[3] !== name) throw Error('Packaged package/version mismatch');
  return { nativeFlagsVerified: true, manifestProfileableVerified: true, packageName: pkg[1] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, root, report, sourceCommit, apk, aapt, code, name] = process.argv.slice(2);
  const mode = resolveDiagnosticMode();
  if (command === 'resolve') console.log([mode.broad, mode.focused, mode.native, mode.mode, mode.diagnostic].join('|'));
  else if (command === 'verify') {
    const result = { sourceCommit, ...mode, ...verifyWebAssets(root, mode, apk), ...(apk ? verifyNativeArtifact(root, apk, aapt, mode, code, name) : {}) };
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    console.log(`Diagnostic mode/assets verified: ${mode.mode}`);
  } else throw Error('Expected resolve or verify');
}
