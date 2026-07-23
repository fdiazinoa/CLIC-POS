import assert from 'node:assert/strict';
import test from 'node:test';

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

const resetRuntime = () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
    localStorage.setItem('CLIC_POS_DEVICE_ID', deviceId);
    localStorage.setItem('clic_tenant_id', 'tenant-config-push');
    localStorage.setItem('clic_erp_sync_tenant_id', 'tenant-config-push');
    localStorage.setItem('clic_erp_sync_terminal_id', terminalId);
    localStorage.setItem('clic_erp_sync_local_terminal_id', 'T3');
    localStorage.setItem('CONFIG_PUSH_V2_ENABLED', 'true');
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

test('register and heartbeat advertise explicit empty capabilities when CONFIG_PUSH_V2 is disabled', async () => {
    resetRuntime();
    localStorage.setItem('CONFIG_PUSH_V2_ENABLED', 'false');

    const requestBodies = new Map<string, Record<string, unknown>>();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body || '{}'));
        if (url.includes('/terminals/register')) {
            requestBodies.set('register', body);
            return Response.json({ status: 'success' });
        }
        if (url.includes('/terminals/heartbeat')) {
            requestBodies.set('heartbeat', body);
            return Response.json({ status: 'success' });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await lifecycle.registerErpSyncTerminal({ deviceId, terminalId, localTerminalId: 'T3' });
    await lifecycle.heartbeatErpSyncTerminal({ deviceId, terminalId, pendingEvents: 0 });

    for (const body of requestBodies.values()) {
        assert.deepEqual(body.sync_capabilities, []);
        assert.deepEqual(body.capabilities, []);
    }
    assert.equal(requestBodies.size, 2);
});

test('register and heartbeat advertise CONFIG_PUSH_V2 when enabled', async () => {
    resetRuntime();

    const requestBodies = new Map<string, Record<string, unknown>>();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body || '{}'));
        if (url.includes('/terminals/register')) {
            requestBodies.set('register', body);
            return Response.json({ status: 'success' });
        }
        if (url.includes('/terminals/heartbeat')) {
            requestBodies.set('heartbeat', body);
            return Response.json({ status: 'success' });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await lifecycle.registerErpSyncTerminal({ deviceId, terminalId, localTerminalId: 'T3' });
    await lifecycle.heartbeatErpSyncTerminal({ deviceId, terminalId, pendingEvents: 0 });

    for (const body of requestBodies.values()) {
        assert.deepEqual(body.sync_capabilities, ['CONFIG_PUSH_V2']);
        assert.deepEqual(body.capabilities, ['CONFIG_PUSH_V2']);
    }
    assert.equal(requestBodies.size, 2);
});
