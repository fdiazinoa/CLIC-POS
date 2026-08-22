import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isSyncHintV2Payload,
    payloadAppliesToRealtimeScope,
} from '../services/sync/RealtimeHintScope';

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
