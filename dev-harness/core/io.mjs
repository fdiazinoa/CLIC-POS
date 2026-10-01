import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withFileLock(lockFile, action, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const staleMs = options.staleMs || 30000;
  const started = Date.now();
  await mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  while (!handle) {
    try {
      handle = await open(lockFile, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const metadata = await stat(lockFile).catch(() => null);
      if (metadata && Date.now() - metadata.mtimeMs > staleMs) {
        await unlink(lockFile).catch(() => {});
        continue;
      }
      if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for lock: ${lockFile}`);
      await wait(25);
    }
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockFile).catch(() => {});
  }
}

export function now() {
  return new Date().toISOString();
}

export function assertSafeId(value, label = 'identifier') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value || '')) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}
