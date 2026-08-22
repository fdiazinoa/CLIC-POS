import assert from 'node:assert/strict';
import test from 'node:test';

import { createErpHeartbeatScheduler } from '../utils/erpHeartbeatScheduler';

class MemoryStorage {
    private values = new Map<string, string>();

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string) {
        this.values.set(key, String(value));
    }

    removeItem(key: string) {
        this.values.delete(key);
    }

    clear() {
        this.values.clear();
    }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
Object.assign(globalThis, {
    localStorage,
    sessionStorage,
    window: {
        setTimeout,
        clearTimeout,
        dispatchEvent: () => true,
    },
});

const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
const deviceId = 'DEV-QA-CONFIG-PUSH';
const versionHash = 'version-already-installed';

const resetRuntime = (options: { configPushV2?: string | null } = {}) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
    localStorage.setItem('CLIC_POS_DEVICE_ID', deviceId);
    localStorage.setItem('clic_tenant_id', 'tenant-config-push');
    localStorage.setItem('clic_erp_sync_tenant_id', 'tenant-config-push');
    localStorage.setItem('clic_erp_sync_terminal_id', terminalId);
    localStorage.setItem('clic_erp_sync_local_terminal_id', 'T3');
    if (options.configPushV2 !== null) {
        localStorage.setItem('CONFIG_PUSH_V2_ENABLED', options.configPushV2 || 'true');
    }
    localStorage.setItem('clic_pos_config_push_v2_state', JSON.stringify({
        versionHash,
        domainVersions: { prices: 1 },
        inFlight: null,
    }));
};

const event = (id: string) => ({
    id,
    event_type: 'CONFIG_PUSH_V2',
    status: 'PROCESSING',
    payload: {
        contract_version: 2,
        snapshot_id: 'snapshot-prices-1',
        version_hash: versionHash,
        versions: { prices: 1 },
        scopes: ['prices'],
        terminal_id: terminalId,
    },
});

const lifecycle = await import('../utils/erpSyncLifecycle');

test('outbox pull and ACK send the bound tenant, terminal and device identity', async () => {
    resetRuntime();
    let pullUrl: URL | null = null;
    let ackBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.includes('/outbox/pull')) {
            pullUrl = url;
            return Response.json({ status: 'success', events: [event('outbox-identity')] });
        }
        if (url.pathname.includes('/outbox/ack')) {
            ackBody = JSON.parse(String(init?.body || '{}'));
            return Response.json({ status: 'success', outbox_id: 'outbox-identity', applied_status: 'APPLIED' });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const result = await lifecycle.triggerErpSyncOutbox('startup');

    assert.equal(result?.applied, 1);
    assert.equal(pullUrl?.searchParams.get('tenant_id'), 'tenant-config-push');
    assert.equal(pullUrl?.searchParams.get('terminal_id'), terminalId);
    assert.equal(pullUrl?.searchParams.get('device_id'), deviceId);
    assert.equal(ackBody?.tenant_id, 'tenant-config-push');
    assert.equal(ackBody?.terminal_id, terminalId);
    assert.equal(ackBody?.device_id, deviceId);
});

test('manual and force triggers share one outbox pull and one ACK', async () => {
    resetRuntime();
    let pulls = 0;
    let acks = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/outbox/pull')) {
            pulls += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return Response.json({ status: 'success', events: [event('outbox-single-flight')] });
        }
        if (url.includes('/outbox/ack')) {
            acks += 1;
            return Response.json({ status: 'success', outbox_id: 'outbox-single-flight', applied_status: 'APPLIED' });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const [manual, forced] = await Promise.all([
        lifecycle.triggerErpSyncOutbox('manual_sync'),
        lifecycle.triggerErpSyncOutbox('force_sync'),
    ]);

    assert.equal(pulls, 1);
    assert.equal(acks, 1);
    assert.equal(manual?.applied, 1);
    assert.deepEqual(forced, manual);
});

test('ACK network failure keeps the event pending and a later trigger recovers it', async () => {
    resetRuntime();
    let failAck = true;
    let ackAttempts = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/outbox/pull')) {
            return Response.json({ status: 'success', events: [event('outbox-ack-retry')] });
        }
        if (url.includes('/outbox/ack')) {
            ackAttempts += 1;
            if (failAck) throw new Error('network unavailable');
            return Response.json({ status: 'success', outbox_id: 'outbox-ack-retry', applied_status: 'APPLIED' });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const first = await lifecycle.triggerErpSyncOutbox('startup');
    assert.equal(first?.applied, 0);
    assert.equal(first?.failed, 0);
    assert.equal(JSON.parse(localStorage.getItem('clic_pos_config_push_v2_state') || '{}').inFlight.eventId, 'outbox-ack-retry');

    failAck = false;
    const recovered = await lifecycle.triggerErpSyncOutbox('app_resumed');
    assert.equal(recovered?.applied, 1);
    assert.equal(ackAttempts, 2);
    assert.equal(JSON.parse(localStorage.getItem('clic_pos_config_push_v2_state') || '{}').inFlight, null);
});

test('heartbeat reports an unacknowledged CONFIG_PUSH_V2 event', async () => {
    resetRuntime();
    localStorage.setItem('clic_pos_config_push_v2_state', JSON.stringify({
        versionHash,
        domainVersions: { prices: 1 },
        inFlight: {
            eventId: 'outbox-pending-heartbeat',
            snapshotId: 'snapshot-prices-1',
            versionHash,
            scopes: ['prices'],
            attempts: 1,
            lastError: 'network unavailable',
            updatedAt: new Date().toISOString(),
        },
    }));

    let heartbeatBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (!url.includes('/terminals/heartbeat')) throw new Error(`Unexpected request: ${url}`);
        heartbeatBody = JSON.parse(String(init?.body || '{}'));
        return Response.json({ status: 'success' });
    }) as typeof fetch;

    await lifecycle.heartbeatErpSyncTerminal({
        deviceId,
        terminalId,
        pendingEvents: 0,
    });

    assert.equal(heartbeatBody?.pending_events, 1);
});

test('CONFIG_PUSH_V2 is enabled by default without a local flag or environment override', () => {
    resetRuntime({ configPushV2: null });
    assert.equal(lifecycle.isConfigPushV2Enabled(), true);
});

test('an explicit false keeps CONFIG_PUSH_V2 disabled as an emergency switch', () => {
    resetRuntime({ configPushV2: 'false' });
    assert.equal(lifecycle.isConfigPushV2Enabled(), false);
});

test('register and heartbeat keep VARIANT_PROMOTIONS when CONFIG_PUSH_V2 is disabled', async () => {
    resetRuntime({ configPushV2: 'false' });

    const requestBodies = new Map<string, Record<string, unknown>>();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body || '{}'));
        if (url.includes('/terminals/register')) {
            requestBodies.set('register', body);
            return Response.json({ status: 'success', terminal: { id: terminalId } });
        }
        if (url.includes('/terminals/heartbeat')) {
            requestBodies.set('heartbeat', body);
            return Response.json({ status: 'success', terminal: { id: terminalId } });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await lifecycle.registerErpSyncTerminal({ deviceId, terminalId, localTerminalId: 'T3' });
    await lifecycle.heartbeatErpSyncTerminal({ deviceId, terminalId, pendingEvents: 0 });

    for (const body of requestBodies.values()) {
        assert.deepEqual(body.sync_capabilities, ['VARIANT_PROMOTIONS']);
        assert.deepEqual(body.capabilities, ['VARIANT_PROMOTIONS']);
        assert.deepEqual(body.capability_versions, { VARIANT_PROMOTIONS: 1 });
    }
    assert.equal(requestBodies.size, 2);
});

test('register and heartbeat advertise CONFIG_PUSH_V2 and VARIANT_PROMOTIONS by default', async () => {
    resetRuntime({ configPushV2: null });

    const requestBodies = new Map<string, Record<string, unknown>>();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body || '{}'));
        if (url.includes('/terminals/register')) {
            requestBodies.set('register', body);
            return Response.json({ status: 'success', terminal: { id: terminalId } });
        }
        if (url.includes('/terminals/heartbeat')) {
            requestBodies.set('heartbeat', body);
            return Response.json({ status: 'success', terminal: { id: terminalId } });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await lifecycle.registerErpSyncTerminal({ deviceId, terminalId, localTerminalId: 'T3' });
    await lifecycle.heartbeatErpSyncTerminal({ deviceId, terminalId, pendingEvents: 0 });

    for (const body of requestBodies.values()) {
        assert.deepEqual(body.sync_capabilities, ['CONFIG_PUSH_V2', 'VARIANT_PROMOTIONS']);
        assert.deepEqual(body.capabilities, ['CONFIG_PUSH_V2', 'VARIANT_PROMOTIONS']);
        assert.deepEqual(body.capability_versions, { VARIANT_PROMOTIONS: 1 });
    }
    assert.equal(requestBodies.size, 2);
});

test('pairing seguido de operación mantiene llamadas periódicas al endpoint ERP real', async () => {
    resetRuntime();
    const endpointCalls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        endpointCalls.push(url.pathname);
        return Response.json({
            status: 'success',
            terminal: { id: terminalId, device_id: deviceId, name: 'Caja 4', status: 'ONLINE' },
        });
    }) as typeof fetch;

    const sendHeartbeat = async () => {
        await lifecycle.heartbeatErpSyncTerminal({
            deviceId,
            terminalId,
            localTerminalId: 'POS-004',
            terminalName: 'Caja 4',
            pendingEvents: 0,
        });
    };

    // Heartbeat inmediato al finalizar pairing.
    await sendHeartbeat();

    let scheduledCallback: (() => void) | null = null;
    const scheduler = createErpHeartbeatScheduler({
        intervalMs: 60_000,
        getJitterMs: () => 4_000,
        sendHeartbeat,
        timerApi: {
            setTimeout: (callback, delayMs) => {
                assert.equal(delayMs, 64_000);
                scheduledCallback = callback;
                return callback;
            },
            clearTimeout: (timerId) => {
                if (scheduledCallback === timerId) scheduledCallback = null;
            },
        },
    });
    scheduler.start();

    for (let interval = 0; interval < 2; interval += 1) {
        assert.ok(scheduledCallback);
        const callback = scheduledCallback;
        scheduledCallback = null;
        callback();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    scheduler.stop();

    assert.deepEqual(endpointCalls, [
        '/api/sync/terminals/heartbeat',
        '/api/sync/terminals/heartbeat',
        '/api/sync/terminals/heartbeat',
    ]);
});

test('DEVICE_SUPERSEDED en heartbeat directo conserva la revocación actual', async () => {
    resetRuntime();
    let revokedDetail: Record<string, unknown> | null = null;
    (globalThis.window as any).dispatchEvent = (event: CustomEvent<Record<string, unknown>>) => {
        if (event.type === 'clic-pos-device-revoked') revokedDetail = event.detail;
        return true;
    };
    globalThis.fetch = (async () => Response.json({
        code: 'DEVICE_SUPERSEDED',
        message: 'Este dispositivo ya no está autorizado.',
    }, { status: 403 })) as typeof fetch;

    await assert.rejects(
        lifecycle.heartbeatErpSyncTerminal({ deviceId, terminalId, pendingEvents: 0 }),
        /ya no está autorizado/i,
    );

    assert.equal(revokedDetail?.reason, 'DEVICE_SUPERSEDED');
    assert.equal(revokedDetail?.terminalId, terminalId);
    assert.equal(revokedDetail?.previousDeviceId, deviceId);
});

test('bootstrap y timer comparten un único heartbeat HTTP en vuelo', async () => {
    resetRuntime();
    let heartbeatRequests = 0;
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    globalThis.fetch = (async () => {
        heartbeatRequests += 1;
        await requestGate;
        return Response.json({ status: 'success' });
    }) as typeof fetch;

    const input = { deviceId, terminalId, localTerminalId: 'POS-004', pendingEvents: 0 };
    const bootstrapHeartbeat = lifecycle.heartbeatErpSyncTerminal(input);
    const periodicHeartbeat = lifecycle.heartbeatErpSyncTerminal(input);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(heartbeatRequests, 1);
    releaseRequest();
    await Promise.all([bootstrapHeartbeat, periodicHeartbeat]);
});
