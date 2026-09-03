import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../utils/cloudMasterRegistry.ts', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('const getLocalNetworkCandidates ='), source.indexOf('const resolveLocalIpv4Addresses ='));
function candidates(nativeAndroid: boolean, protocol: string, hostname: string) {
  return runInNewContext(ts.transpile(`${methods}\n({ network: getLocalNetworkCandidates, registry: getLocalCloudRegistryCandidates });`, { target: ts.ScriptTarget.ES2022 }), {
    window: { location: { protocol, hostname } },
    isNativeAndroidRuntime: () => nativeAndroid,
    dedupeStrings: (values: string[]) => [...new Set(values)],
  });
}

test('native Android probes the actual HTTP service without TLS or Capacitor asset fallbacks', () => {
  const result = candidates(true, 'https:', 'localhost');
  assert.deepEqual(Array.from(result.network()), ['http://127.0.0.1:3001/api/network', 'http://localhost:3001/api/network']);
  assert.deepEqual(Array.from(result.registry('/api/cloud/resolve', 'test=1')), ['http://127.0.0.1:3001/api/cloud/resolve?test=1', 'http://localhost:3001/api/cloud/resolve?test=1']);
});

test('HTTPS and HTTP browsers retain their original protocol and relative proxy candidates', () => {
  for (const protocol of ['https:', 'http:']) {
    const result = candidates(false, protocol, 'pos.example');
    assert.deepEqual(Array.from(result.network()), [
      `${protocol}//pos.example:3001/api/network`, '/api/network',
      'http://127.0.0.1:3001/api/network', 'http://localhost:3001/api/network',
    ]);
  }
});
