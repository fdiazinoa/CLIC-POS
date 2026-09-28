import assert from 'node:assert/strict';
import test from 'node:test';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { requestJson } from '../services/network/httpClient';

test('Android mutating authority request uses abortable transport and never dispatches CapacitorHttp after reset', async () => {
  const originalNative = Capacitor.isNativePlatform;
  const originalPlatform = Capacitor.getPlatform;
  const originalNativeRequest = CapacitorHttp.request;
  const originalFetch = globalThis.fetch;
  let nativePosts = 0;
  let webPosts = 0;
  (Capacitor as any).isNativePlatform = () => true;
  (Capacitor as any).getPlatform = () => 'android';
  (CapacitorHttp as any).request = async () => { nativePosts += 1; return { status: 200, data: {} }; };
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    webPosts += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  }) as typeof fetch;
  try {
    const authority = new AbortController();
    const pending = requestJson({
      url: 'http://10.0.0.129:3001/api/sync/push', method: 'POST', body: '{}',
      signal: authority.signal, requireAbortableTransport: true,
    });
    authority.abort();
    await assert.rejects(pending, (error: any) => error?.name === 'AbortError');
    assert.equal(nativePosts, 0);
    assert.equal(webPosts, 0);
  } finally {
    (Capacitor as any).isNativePlatform = originalNative;
    (Capacitor as any).getPlatform = originalPlatform;
    (CapacitorHttp as any).request = originalNativeRequest;
    globalThis.fetch = originalFetch;
  }
});
