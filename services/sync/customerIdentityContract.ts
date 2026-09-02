import type { Customer, Transaction } from '../../types';

const firstText = (...values: unknown[]): string | undefined => values
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();

/** The UUID is transport identity, never the visible customer code. */
export const customerNumberIdentity = (customer: Partial<Customer> = {}) => ({
    customer_code: firstText(customer.customer_code, customer.customerCode, customer.external_code, customer.externalCode),
    master_number_range_id: firstText(customer.master_number_range_id),
    master_number_value: Number.isSafeInteger(customer.master_number_value) ? customer.master_number_value : undefined,
    source_terminal_id: firstText(customer.source_terminal_id),
    created_source: firstText(customer.created_source),
});

/** Freeze the assigned number before committing the sale; retries never allocate a number. */
export const withCustomerNumberSnapshot = <T extends Partial<Transaction>>(transaction: T, customer?: Customer | null): T => {
    if (!transaction.customerId || !customer || customer.id !== transaction.customerId) return transaction;
    const existing = transaction.customerSnapshot;
    if (customerNumberIdentity(existing).customer_code) return transaction;
    const identity = customerNumberIdentity(customer);
    if (!identity.customer_code) return transaction;
    return {
        ...transaction,
        customerSnapshot: { name: customer.name, ...existing, ...identity },
    };
};

export const buildCustomerMutationEnvelope = (mutation: {
    id: string; customerId: string; terminalId: string; operation: string;
    customer?: Customer; createdAt: string;
}) => ({
    event_id: mutation.id,
    source_customer_mutation_id: mutation.id,
    source_customer_id: mutation.customerId,
    source_terminal_id: mutation.terminalId,
    operation: mutation.operation,
    occurred_at: mutation.createdAt,
    created_at: mutation.createdAt,
    customer: mutation.customer && {
        ...mutation.customer,
        ...customerNumberIdentity(mutation.customer),
        tax_id: mutation.customer.taxId,
        credit_limit: mutation.customer.creditLimit,
        credit_days: mutation.customer.creditDays,
    },
});

/** Do not acknowledge range consumption unless ERP confirms the same assigned code. */
export const assertCustomerNumberAcknowledgement = (response: { results?: Record<string, unknown>[] } | null, customer?: Customer) => {
    const expected = customerNumberIdentity(customer);
    if (!expected.master_number_range_id || !expected.customer_code) return;
    const result = response?.results?.find(row => row.source_customer_id === customer?.id);
    if (!result || !['APPLIED', 'DUPLICATE'].includes(String(result.status))
        || result.error_code || result.customer_code !== expected.customer_code || !result.erp_customer_id) {
        throw new Error('CUSTOMER_CODE_ACK_MISMATCH: ERP no confirmó el consecutivo asignado por el POS.');
    }
};
