import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer, Transaction } from '../types';
import { assertCustomerNumberAcknowledgement, buildCustomerMutationEnvelope, customerNumberIdentity, withCustomerNumberSnapshot } from '../services/sync/customerIdentityContract';
import { buildPaymentPostedPayload, buildSalePostedPayload } from '../services/sync/SalePostedContract';
import { buildErpSalePayload } from '../services/sync/erpOutboundPayloads';

const customer: Customer = {
    id: 'customer-local-uuid', name: 'Cliente de prueba', customer_code: 'CLI-040000',
    master_number_range_id: 'range-uuid', master_number_value: 40000,
    source_terminal_id: 'terminal-uuid', created_source: 'POS',
};
const sale = (): Transaction => ({
    id: 'TXN-1', customerId: customer.id, customerName: customer.name,
    customerSnapshot: { name: customer.name, taxId: '123' },
    date: '2026-09-02T18:00:00Z', total: 100, netAmount: 100, taxAmount: 0,
    items: [{ id: 'item', quantity: 1, price: 100, totalAmount: 100 }],
    payments: [{ id: 'payment', method: 'CASH', amount: 100 }],
    documentType: 'TICKET' as const,
} as Transaction);

test('freezes the assigned range code into both sale and payment events', () => {
    const original = sale();
    const frozen = withCustomerNumberSnapshot(original, customer);
    assert.deepEqual(original, sale(), 'does not mutate caller data');
    for (const event of [buildSalePostedPayload(frozen), buildPaymentPostedPayload(frozen)]) {
        assert.equal(event?.summary.customer_id, customer.id);
        assert.equal(event?.summary.customer_code, 'CLI-040000');
        assert.equal(event?.summary.customer.master_number_range_id, 'range-uuid');
        assert.equal(event?.summary.customer.master_number_value, 40000);
    }
    const legacy = buildErpSalePayload(frozen as any);
    assert.equal(legacy.customer_code, 'CLI-040000');
    assert.equal(legacy.customer?.master_number_value, 40000);
});

test('does not use UUID as code, enrich another customer, or renumber a frozen snapshot', () => {
    assert.equal(customerNumberIdentity({ id: 'UUID' }).customer_code, undefined);
    const transaction = sale();
    assert.equal(withCustomerNumberSnapshot(transaction, { ...customer, id: 'other' }), transaction);
    const frozen = withCustomerNumberSnapshot(transaction, customer);
    assert.equal(withCustomerNumberSnapshot(frozen, { ...customer, customer_code: 'CLI-040001' }), frozen);
    assert.equal(buildSalePostedPayload(transaction).summary.customer_code, undefined);
});

test('customer mutation sends the persistent event ID and the same range code on retry', () => {
    const mutation = { id: 'master-number-customer-local-uuid', customerId: customer.id,
        customer: { ...customer, taxId: '123', creditDays: 30, creditLimit: 100 },
        terminalId: 'terminal-uuid', operation: 'UPSERT', createdAt: '2026-09-02T18:00:00Z' };
    const payload = buildCustomerMutationEnvelope(mutation);
    assert.equal(payload.event_id, mutation.id);
    assert.equal(payload.source_customer_id, customer.id);
    assert.equal(payload.customer?.customer_code, 'CLI-040000');
    assert.equal(payload.customer?.tax_id, '123');
    assert.equal(payload.customer?.credit_days, 30);
    assert.deepEqual(buildCustomerMutationEnvelope(mutation), payload);
});

test('range progress requires a successful ACK with the exact customer code', () => {
    const result = { status: 'APPLIED', source_customer_id: customer.id, erp_customer_id: 'erp-uuid', customer_code: 'CLI-040000' };
    assert.doesNotThrow(() => assertCustomerNumberAcknowledgement({ results: [result] }, customer));
    assert.doesNotThrow(() => assertCustomerNumberAcknowledgement({ results: [{ ...result, status: 'DUPLICATE' }] }, customer));
    for (const response of [null, {}, { results: [{ ...result, customer_code: 'POS-ABC' }] },
        { results: [{ ...result, source_customer_id: 'other' }] },
        { results: [{ ...result, status: 'DUPLICATE', error_code: 'CONFLICT' }] }]) {
        assert.throws(() => assertCustomerNumberAcknowledgement(response, customer), /CUSTOMER_CODE_ACK_MISMATCH/);
    }
});
