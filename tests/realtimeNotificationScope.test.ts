import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isSyncHintV2Payload,
    payloadAppliesToRealtimeScope,
} from '../services/sync/RealtimeHintScope';
import { RealtimeNotificationService } from '../services/sync/RealtimeNotificationService';

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
