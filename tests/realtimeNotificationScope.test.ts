import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { RealtimeClient } from '@supabase/supabase-js';

import {
    isSyncHintV2Payload,
    payloadAppliesToRealtimeScope,
} from '../services/sync/RealtimeHintScope';
import { RealtimeNotificationService } from '../services/sync/RealtimeNotificationService';
import { FISCAL_PRINT_HINT, onFiscalPrintHint } from '../services/fiscal/FiscalPrintHint';

const binding = {
    tenantId: 'tenant-a',
    storeId: 'store-a',
    terminalId: 'terminal-uuid-a',
    localTerminalId: 'POS-001',
    companyId: null,
    terminalUuid: null,
    terminalName: null,
};

const hint = {
    type: 'SYNC_HINT',
    protocolVersion: 2,
    tenantId: 'tenant-a',
    storeId: 'store-a',
    terminalId: 'POS-001',
    domainVersions: { catalog: 381, prices: 19 },
};

test('accepts a scoped SYNC_HINT v2 for the local terminal', () => {
    assert.equal(isSyncHintV2Payload(hint), true);
    assert.equal(payloadAppliesToRealtimeScope(hint, binding, true), true);
});

test('rejects malformed protocol versions and missing strict scope', () => {
    assert.equal(isSyncHintV2Payload({ ...hint, protocolVersion: 1 }), false);
    assert.equal(payloadAppliesToRealtimeScope({ type: 'SYNC_HINT', protocolVersion: 2 }, binding, true), false);
});

test('rejects tenant, store and terminal mismatches', () => {
    assert.equal(payloadAppliesToRealtimeScope({ ...hint, tenantId: 'tenant-b' }, binding, true), false);
    assert.equal(payloadAppliesToRealtimeScope({ ...hint, storeId: 'store-b' }, binding, true), false);
    assert.equal(payloadAppliesToRealtimeScope({ ...hint, terminalId: 'POS-999' }, binding, true), false);
});

test('accepts wildcard terminal only inside the matching tenant and store', () => {
    assert.equal(payloadAppliesToRealtimeScope({ ...hint, terminalId: '*' }, binding, true), true);
});

test('disconnect during realtime authorization prevents stale channel creation', async () => {
    let resolveAuthorization!: (value: any) => void;
    const authorization = new Promise<any>(resolve => { resolveAuthorization = resolve; });
    let channelCalls = 0;
    const service = new RealtimeNotificationService((async () => authorization) as any);
    (service as any).connectionGeneration = 1;
    const connecting = (service as any).connect('http://10.0.0.129:3001', 'tenant-a', 'store-a', 'terminal-a', 1);
    await Promise.resolve();
    await service.disconnect('DISABLED');
    resolveAuthorization({
        client: { channel: () => { channelCalls += 1; return {}; } },
        scope: { tenantId: 'tenant-a', storeId: 'store-a', terminalId: 'terminal-a' },
    });
    await connecting;
    assert.equal(channelCalls, 0);
    assert.equal(service.getState(), 'DISABLED');
    assert.deepEqual((service as any).channels, []);
});

test('rejoins a private channel after an interrupted join and delivers one fiscal print hint', async (t) => {
    const scope = {
        tenantId: 'tenant-a',
        storeId: 'store-a',
        terminalId: '11111111-2222-4333-8444-555555555555',
        deviceId: 'device-a',
    };
    const transactionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const terminalTopic = `realtime:sync:${scope.tenantId}:${scope.storeId}:${scope.terminalId}`;
    const terminalJoinRefs: string[] = [];
    const store = new Map([
        ['clic_erp_sync_tenant_id', scope.tenantId],
        ['clic_erp_sync_store_id', scope.storeId],
        ['clic_erp_sync_terminal_id', scope.terminalId],
    ]);
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, value),
        },
    });

    // Keep the SDK and channel implementation real while isolating the server.
    class LoopbackSocket extends EventTarget {
        readonly CONNECTING = 0;
        readonly OPEN = 1;
        readonly CLOSING = 2;
        readonly CLOSED = 3;
        readyState = this.CONNECTING;
        protocol = '';
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        readonly url: string;

        constructor(address: string | URL) {
            super();
            this.url = String(address);
            queueMicrotask(() => {
                this.readyState = this.OPEN;
                this.onopen?.(new Event('open'));
            });
        }

        send(raw: string) {
            const [joinRef, ref, topic, event] = JSON.parse(raw);
            const reply = (name: string, payload: unknown, replyRef = ref) =>
                queueMicrotask(() => this.onmessage?.(new MessageEvent('message', {
                    data: JSON.stringify([joinRef, replyRef, topic, name, payload]),
                })));

            if (event === 'phx_join' && topic === terminalTopic) {
                terminalJoinRefs.push(ref);
                if (terminalJoinRefs.length === 1) {
                    // Interrupt the join while its original timeout is still active.
                    reply('phx_error', {}, null);
                    return;
                }
                if (!ref || !joinRef) return;
                reply('phx_reply', { status: 'ok', response: {} });
                reply('broadcast', { event: FISCAL_PRINT_HINT, payload: { ...scope, transactionId, version: 1 } }, null);
                return;
            }
            if (['phx_join', 'phx_leave', 'heartbeat'].includes(event)) {
                reply('phx_reply', { status: 'ok', response: {} });
            }
        }

        close() {
            this.readyState = this.CLOSED;
            this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
        }
    }

    const client = new RealtimeClient('ws://localhost/realtime/v1', {
        params: { apikey: 'local-fixture' },
        transport: LoopbackSocket,
        timeout: 250,
        reconnectAfterMs: () => 25,
    });
    const service = new RealtimeNotificationService((async () => ({ client, scope })) as any);
    t.after(async () => {
        try {
            await service.disconnect();
        } finally {
            client.disconnect();
            if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
            else Reflect.deleteProperty(globalThis, 'localStorage');
        }
    });
    const states: string[] = [];
    t.after(service.subscribeState(state => states.push(state)));
    const received = new EventTarget();
    let wakeCount = 0;
    t.after(onFiscalPrintHint(transactionId, () => {
        wakeCount += 1;
        received.dispatchEvent(new Event('wake'));
    }));
    const wake = once(received, 'wake', { signal: AbortSignal.timeout(4_000) });
    await (service as any).connect('https://localhost', scope.tenantId, scope.storeId, scope.terminalId, 0);
    await wake;

    assert.equal(terminalJoinRefs.length, 2);
    assert.ok(terminalJoinRefs[0] && terminalJoinRefs[1]);
    assert.notEqual(terminalJoinRefs[0], terminalJoinRefs[1]);
    assert.deepEqual(states, ['DISABLED', 'CONNECTING', 'DEGRADED', 'HEALTHY']);
    assert.equal(wakeCount, 1);
});
