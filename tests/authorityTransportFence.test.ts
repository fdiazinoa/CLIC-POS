import assert from 'node:assert/strict';
import test from 'node:test';
import { Capacitor } from '@capacitor/core';
import { requestJson, setNativeRequestTransportForTests } from '../services/network/httpClient';

test('Android LAN mutation keeps the legacy CapacitorHttp transport contract', async () => {
  const originalNative = Capacitor.isNativePlatform;
  const originalPlatform = Capacitor.getPlatform;
  const originalFetch = globalThis.fetch;
  let nativePosts = 0;
  let webPosts = 0;
  (Capacitor as any).isNativePlatform = () => true;
  (Capacitor as any).getPlatform = () => 'android';
  setNativeRequestTransportForTests((async () => { nativePosts += 1; return { status: 200, data: {} }; }) as any);
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    webPosts += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  }) as typeof fetch;
  try {
    const result = await requestJson({
      url: 'http://10.0.0.129:3001/api/sync/push', method: 'POST', body: '{}',
    });
    assert.equal(result.status, 200);
    assert.equal(nativePosts, 1);
    assert.equal(webPosts, 0);
  } finally {
    (Capacitor as any).isNativePlatform = originalNative;
    (Capacitor as any).getPlatform = originalPlatform;
    setNativeRequestTransportForTests(null);
    globalThis.fetch = originalFetch;
  }
});
