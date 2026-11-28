import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteFiscalRecoveryIdentity } from '../services/fiscal/AbsoluteFiscalRecoveryIdentity';
import { createFiscalWorkflowV2Client } from '../services/fiscal/FiscalWorkflowV2Client';
import { fiscalWorkflowScopeKey, type FiscalWorkflowCheckoutV2 } from '../services/fiscal/FiscalWorkflowV2Types';

const scope = {
    tenantId: 'b2e01916-309a-414f-b9f0-636352d25318', companyId: '39ac760d-bd18-4611-8251-84eaec00dea1',
    storeId: '7f3a2d1a-4d10-4f9c-afed-9b4d55f417c2', terminalId: '31d2162e-1767-4f74-8e72-7c73a3341e96', deviceId: 'synthetic-device',
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ncf = 'E320000000001';
const checkout: FiscalWorkflowCheckoutV2 = {
    checkoutId: '496e3827-0000-4000-8000-000000000001', transactionId: uuid(2), operationId: uuid(3),
    scopeKey: fiscalWorkflowScopeKey(scope), cartIdentity: 'private fixture data', permit: null, phase: 'EFFECT_POSSIBLE', paymentIds: [`${uuid(4)}:payment:0`],
    allocation: { authorizationId: uuid(5), allocationId: uuid(6), fiscalRangeId: uuid(7), ncf, ncfType: 'E32', bufferId: uuid(8), sequence: 1, authorityHash: 'a'.repeat(64), environment: 2 },
    allocationIssuance: {
        schemaVersion: 1, source: 'POS_FISCAL_RESERVATION_V1', ncf, ncfType: 'E32', sequence: 1, prefix: 'E32', fiscalRangeId: uuid(7), fiscalAllocationId: uuid(6),
        rangeStart: 1, rangeEnd: 10, allocationStart: 1, allocationEnd: 10, expiryDate: null, issuerRnc: '131397662',
        tenantId: scope.tenantId, companyId: scope.companyId, terminalId: scope.terminalId, capturedAt: '2026-11-27T00:00:00.000Z',
    },
};

test('the Absolute incident identity is local, read-only and limited to its exact scope and checkout', async () => {
    let reads = 0;
    let sessionChecks = 0;
    let descriptor = { ...scope, terminalId: uuid(9) };
    const client = createFiscalWorkflowV2Client({
        store: () => ({ currentCheckout: async (key: string) => { reads++; assert.equal(key, checkout.scopeKey); return checkout; } }),
        readAuth: () => ({ descriptor, assertCurrent: () => { sessionChecks++; } }),
        fetchImpl: async () => { assert.fail('identity lookup must not call the ERP'); },
    } as any);

    assert.equal(await client.readAbsoluteRecoveryIdentity(), null);
    assert.equal(reads, 0);
    descriptor = scope;
    assert.deepEqual(await client.readAbsoluteRecoveryIdentity(), {
        checkoutId: checkout.checkoutId, transactionId: checkout.transactionId, operationId: checkout.operationId,
        authorizationId: uuid(5), allocationId: uuid(6), ncf,
    });
    assert.equal(reads, 1);
    assert.equal(sessionChecks, 2);
    assert.equal(absoluteFiscalRecoveryIdentity(scope, { ...checkout, checkoutId: uuid(10) }), null);
    assert.equal(absoluteFiscalRecoveryIdentity(scope, { ...checkout, scopeKey: fiscalWorkflowScopeKey({ ...scope, deviceId: 'different' }) }), null);
    assert.equal(absoluteFiscalRecoveryIdentity(scope, { ...checkout, allocation: { ...checkout.allocation!, environment: 1 } }), null);
});
