import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
