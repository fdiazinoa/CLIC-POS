import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function inspectApk(apkPath, gradlePath) {
  if (!apkPath.toLowerCase().endsWith('.apk')) throw new Error('Artifact must be an APK');
  const bytes = await readFile(apkPath);
  const gradle = await readFile(gradlePath, 'utf8');
  const versionName = /versionName\s+["']([^"']+)["']/.exec(gradle)?.[1];
  const versionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1];
  if (!versionName || !versionCode) throw new Error('Unable to resolve Android version from build.gradle');
  const metadata = await stat(apkPath);
  return {
    filename: path.basename(apkPath),
    path: path.resolve(apkPath),
    size_bytes: metadata.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    version_name: versionName,
    version_code: Number(versionCode)
  };
}

export function verifyApkSignature(apkPath, apksignerPath) {
  const result = spawnSync(apksignerPath, ['verify', '--verbose', '--print-certs', apkPath], {
    encoding: 'utf8', maxBuffer: 2 * 1024 * 1024
  });
  return {
    verified: result.status === 0,
    exit_code: result.status,
    output_sha256: createHash('sha256').update(`${result.stdout || ''}${result.stderr || ''}`).digest('hex'),
    output_bytes: Buffer.byteLength(`${result.stdout || ''}${result.stderr || ''}`)
  };
}
