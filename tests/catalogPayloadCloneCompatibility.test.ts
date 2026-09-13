import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneCatalogPayload } from '../services/sync/preserveLocalCatalog';

test('catalog snapshot cloning works in Android WebViews without structuredClone', () => {
    const original = globalThis.structuredClone;
    const payload = [{
        id: 'item-1',
        price: 6500,
        appliedTaxIds: ['tax-18'],
        operationalFlags: { promptPrice: true },
    }];

    try {
        Object.defineProperty(globalThis, 'structuredClone', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        const clone = cloneCatalogPayload(payload);
        assert.deepEqual(clone, payload);
        assert.notEqual(clone, payload);
        assert.notEqual(clone[0], payload[0]);
        assert.notEqual(clone[0].operationalFlags, payload[0].operationalFlags);
    } finally {
        Object.defineProperty(globalThis, 'structuredClone', {
            configurable: true,
            writable: true,
            value: original,
        });
    }
});
