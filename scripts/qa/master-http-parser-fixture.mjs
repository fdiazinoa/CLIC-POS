import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Compile the literal production parser, not a second implementation of it.
export function parserFixture(source, mutation = '') {
  const begin = '                val input = ';
  const end = '                when {';
  const handle = source.indexOf('    private fun handleClient(socket: Socket) {');
  const start = source.indexOf(begin, handle);
  const stop = source.indexOf(end, start);
  assert.ok(handle >= 0 && start > handle && stop > start, 'production parser boundaries missing');
  let prefix = source.slice(start, stop);
  assert.equal((prefix.match(/client\.getInputStream\(\)/g) || []).length, 1, 'one socket input must serve headers and body');
  assert.equal((prefix.match(/if \(requestLine\.isBlank\(\)\) return/g) || []).length, 1);
  prefix = prefix.replace('if (requestLine.isBlank()) return', 'if (requestLine.isBlank()) return null');
  if (mutation === 'unbuffered') prefix = prefix.replace('java.io.BufferedInputStream(client.getInputStream())', 'client.getInputStream()');
  if (mutation === 'raw-body') prefix = prefix.replace('input.read(buffer, offset, contentLength - offset)', 'client.getInputStream().read(buffer, offset, contentLength - offset)');
  if (mutation === 'reader') prefix = prefix.replace('val requestLine = readAsciiLine(input)', 'val reader = input.bufferedReader()\n                val requestLine = reader.readLine().orEmpty()').replace('val line = readAsciiLine(input)', 'val line = reader.readLine().orEmpty()');
  const lineStart = source.indexOf('    private fun readAsciiLine(');
  const lineEnd = source.indexOf('    private fun writeResponse(', lineStart);
  assert.ok(lineStart > stop && lineEnd > lineStart, 'production line reader boundaries missing');
  return `package com.clicpos.nativeprinter
import java.net.Socket
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
object ProductionHttpParserFixture {
  data class Parsed(val requestLine: String, val headers: Map<String,String>, val body: String)
  fun parse(client: Socket): Parsed? {
${prefix}
    return Parsed(requestLine, headers, body)
  }
${source.slice(lineStart, lineEnd)}
}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = readFileSync(process.argv[2], 'utf8');
  writeFileSync(process.argv[3], parserFixture(source, process.argv[4] || ''));
}
