import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parserFixture } from '../scripts/qa/master-http-parser-fixture.mjs';

const source = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');
test('production HTTP parser uses one byte buffer shared by headers and body', () => {
  const fixture = parserFixture(source);
  assert.match(fixture, /val input = java\.io\.BufferedInputStream\(client\.getInputStream\(\)\)/);
  assert.match(fixture, /val requestLine = readAsciiLine\(input\)/);
  assert.match(fixture, /val line = readAsciiLine\(input\)/);
  assert.match(fixture, /input\.read\(buffer, offset, contentLength - offset\)/);
  assert.doesNotMatch(fixture, /BufferedReader|bufferedReader|readText/);
  assert.match(source, /client\.soTimeout = 5000/);
});
test('literal Kotlin parser extraction rejects missing or duplicate input boundaries', () => {
  assert.throws(() => parserFixture(source.replace('private fun handleClient(socket: Socket)', 'private fun changed(socket: Socket)')));
  assert.throws(() => parserFixture(source.replace('val body = if (contentLength > 0)', 'val second = client.getInputStream()\n                val body = if (contentLength > 0)')));
  for (const mutation of ['unbuffered', 'raw-body', 'reader']) assert.notEqual(parserFixture(source, mutation), parserFixture(source));
});
test('actual fixture CLI generates Kotlin through a symlink, while import with absent argv has no IO', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clic-pos-parser-cli-'));
  try {
    const entry = join(directory, 'linked-fixture.mjs');
    const output = join(directory, 'ProductionHttpParserFixture.kt');
    symlinkSync(fileURLToPath(new URL('../scripts/qa/master-http-parser-fixture.mjs', import.meta.url)), entry);
    const result = spawnSync(process.execPath, [entry, fileURLToPath(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url)), output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), parserFixture(source));
    const before = readdirSync(directory).sort();
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      assert.equal(process.argv[1], undefined);
      const module = await import(${JSON.stringify(pathToFileURL(entry).href)});
      assert.equal(typeof module.parserFixture, 'function');
    `], { encoding: 'utf8', cwd: directory });
    assert.equal(imported.status, 0, imported.stderr);
    assert.deepEqual(readdirSync(directory).sort(), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
