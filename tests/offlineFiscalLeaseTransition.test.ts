import assert from 'node:assert/strict';
import test from 'node:test';
import { createFiscalWorkflowV2Client } from '../services/fiscal/FiscalWorkflowV2Client';

test('a new checkout uses the active numbered allocation after an acknowledged legacy checkout', async () => {
    const authority = { scope: { tenantId: 'tenant', companyId: 'company', storeId: 'store', terminalId: 'terminal', deviceId: 'device' } };
    const acknowledged = { phase: 'ACKNOWLEDGED', operationId: 'previous-operation', permit: { leaseId: 'revoked-lease' } };
    const nextCheckout = { phase: 'PREPARED', operationId: 'new-operation', allocation: { sequence: 19 } };
    let allocationCalls = 0;
    const store = {
        currentCheckout: async () => acknowledged,
        offlineLease: async () => null,
        allocationAvailability: async () => ({ remaining: { E32: 10 } }),
        reserveAllocationCheckout: async (local, cart, operationId) => {
            assert.equal(local, authority);
            assert.equal(cart, 'new-cart');
            assert.equal(operationId, 'new-operation');
            allocationCalls++;
            return nextCheckout;
        },
    };
    const client = createFiscalWorkflowV2Client({
        readOfflineAuthority: async () => authority,
        store: () => store,
    } as any);

    assert.equal(await client.reserveOfflineCheckout('new-cart', 'new-operation'), nextCheckout);
    await assert.rejects(client.reserveOfflineCheckout('previous-cart', 'previous-operation'), /OFFLINE_FISCAL_LEASE_REQUIRED/);
    assert.equal(allocationCalls, 1);
});
