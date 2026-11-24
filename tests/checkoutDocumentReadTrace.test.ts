import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    attributeCheckoutDocumentRead, beginCheckoutDocumentReads, discardCheckoutDocumentReads,
    finishCheckoutDocumentReads, withCheckoutDocumentReadTrace,
} from '../services/CheckoutDocumentReadTrace';

test('attributes document reads across asynchronous callers and keeps bind values private', async () => {
    const query = withCheckoutDocumentReadTrace(async () => ({ values: [] }));
    const sql = 'SELECT substr(data, ?, ?) FROM documents WHERE collection_name = ? AND doc_id = ?';
    try {
        beginCheckoutDocumentReads('checkout-1');
        for (const offset of [1, 1, 100]) {
            await query(sql, attributeCheckoutDocumentRead([offset, 100, 'config', 'private-id'], 'getCollection checkout'));
        }
        await query(sql, attributeCheckoutDocumentRead([1, 100, 'config', 'private-id'], 'getCollection background'));
        await query('SELECT 1');
        assert.equal(finishCheckoutDocumentReads('different-checkout'), undefined);
        const result = finishCheckoutDocumentReads('checkout-1')!;
        assert.equal(result.count, 4);
        assert.equal(result.distinctGroups, 2);
        const checkout = result.groups.find(row => row.reader === 'getCollection checkout');
        assert.equal(checkout?.collection, 'config');
        assert.equal(checkout?.count, 3);
        assert.equal(checkout?.repeated, 1);
        assert.equal(checkout?.pending, 0);
        assert.equal(JSON.stringify(result).includes('private-id'), false);
        assert.equal(JSON.stringify(result).includes('SELECT'), false);
        await query(sql);
        assert.equal(finishCheckoutDocumentReads(), undefined);
    } finally {
        discardCheckoutDocumentReads();
    }
});

test('preserves the bridge rejection and closes its timing sample', async () => {
    const error = new Error('bridge unavailable');
    const query = withCheckoutDocumentReadTrace(async () => { throw error; });
    try {
        beginCheckoutDocumentReads();
        await assert.rejects(query('SELECT data FROM documents'), value => value === error);
        assert.equal(finishCheckoutDocumentReads()?.groups[0].pending, 0);
    } finally {
        discardCheckoutDocumentReads();
    }
});
