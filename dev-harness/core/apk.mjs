import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

export async function inspectApk(apkPath, aaptPath) {
  if (!apkPath.toLowerCase().endsWith('.apk')) throw new Error('Artifact must be an APK');
  const bytes = await readFile(apkPath);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Artifact is not a ZIP/APK file');
  const aapt = spawnSync(aaptPath, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (aapt.status !== 0) throw new Error('aapt could not inspect APK metadata');
  const packageLine = (aapt.stdout || '').split(/\r?\n/).find((line) => line.startsWith('package:')) || '';
  const versionName = /versionName='([^']+)'/.exec(packageLine)?.[1];
  const versionCode = /versionCode='(\d+)'/.exec(packageLine)?.[1];
  const packageName = /name='([^']+)'/.exec(packageLine)?.[1];
  if (!packageName || !versionName || !versionCode) throw new Error('Unable to resolve package/version from APK');
  const metadata = await stat(apkPath);
  return {
    filename: path.basename(apkPath),
    path: path.resolve(apkPath),
    size_bytes: metadata.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    package_name: packageName,
    version_name: versionName,
    version_code: Number(versionCode)
  };
}

export function verifyApkSignature(apkPath, apksignerPath) {
  if (!statSync(apkPath, { throwIfNoEntry: false })?.isFile()) {
    return { verified: false, exit_code: null, output_sha256: null, output_bytes: 0, reason: 'APK does not exist' };
  }
  const result = spawnSync(apksignerPath, ['verify', '--verbose', '--print-certs', apkPath], {
    encoding: 'utf8', maxBuffer: 2 * 1024 * 1024
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const hasVerificationMarker = /(^|\n)Verifies\s*(\n|$)|Verified using v\d scheme|Signer #1 certificate SHA-256 digest:/i.test(output);
  return {
    verified: result.status === 0 && hasVerificationMarker,
    exit_code: result.status,
    output_sha256: createHash('sha256').update(output).digest('hex'),
    output_bytes: Buffer.byteLength(output),
    verification_marker_present: hasVerificationMarker
  };
}
