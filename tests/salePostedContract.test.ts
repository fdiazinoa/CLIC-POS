import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertSalePostedPayload,
    buildSalePostedPayload,
    buildSalePostedSummary,
    SalePostedContractError,
} from '../services/sync/SalePostedContract';
import { freezeAuthoritativeLineFiscalAmounts } from '../utils/fiscalBreakdown';

const transactionFixture = () => ({
    id: 'TXN-200',
    displayId: 'TCK-200',
    documentType: 'TICKET',
    status: 'COMPLETED',
    date: '2026-08-22T15:38:20.050-04:00',
    total: 100,
    taxAmount: 15,
    netAmount: 90,
    discountAmount: 5,
    items: [
        { id: 'item-1', quantity: 2, price: 999, totalAmount: 60 },
        { id: 'item-2', quantity: 1, price: 999, netAmount: 35, taxAmount: 5 },
    ],
    payments: [{ id: 'payment-1', method: 'CASH', amount: 75 }],
    customerId: 'customer-1',
    customerName: 'Cliente Uno',
    customerSnapshot: { name: 'Cliente Uno', taxId: '00113918205' },
    userId: 'user-1',
    userName: 'Caja Uno',
    ncf: 'B0200000123',
    ncfType: 'B02',
    fiscalMode: 'LEGACY',
    fiscalProvider: 'NONE',
    dueDate: '2026-09-21T19:38:20.050Z',
    pendingBalance: 25,
    settlementAppliedBase: 75,
    walletPaymentAmount: 10,
    walletDepositAmount: 2,
    loyaltyPointsUsed: 4,
    coupons: [{ id: 'coupon-1', code: 'VERANO' }],
    taxBreakdown: [{ id: 'itbis', amount: 15 }],
});

test('builds the exact canonical SALE_POSTED summary from the persisted transaction', () => {
    const transaction = transactionFixture();
    const payload = buildSalePostedPayload(transaction, {
        inventoryMovementIds: ['movement-1'],
        paymentIntentIds: ['intent-1'],
    });

    assert.equal(payload.transaction, transaction);
    assert.equal(payload.occurred_at, '2026-08-22T19:38:20.050Z');
    assert.deepEqual(payload.summary, {
        transaction_id: 'TXN-200',
        display_id: 'TCK-200',
        document_type: 'TICKET',
        status: 'COMPLETED',
        total: 100,
        tax_amount: 15,
        net_amount: 90,
        discount_amount: 5,
        item_count: 2,
        payment_count: 1,
        customer_id: 'customer-1',
        customer_name: 'Cliente Uno',
        customer_tax_id: '00113918205',
        user_id: 'user-1',
        user_name: 'Caja Uno',
        ncf: 'B0200000123',
        ncf_type: 'B02',
        due_date: '2026-09-21T19:38:20.050Z',
        pending_balance: 25,
        settlement_applied_base: 75,
        wallet_payment_amount: 10,
        wallet_deposit_amount: 2,
        loyalty_points_used: 4,
        coupon_codes: ['VERANO', 'coupon-1'],
        fiscal_mode: 'LEGACY',
        fiscal_provider: 'NONE',
        tax_breakdown: [{ id: 'itbis', amount: 15 }],
    });
    assert.deepEqual(assertSalePostedPayload(payload), {
        transactionId: 'TXN-200',
        total: 100,
        lineTotal: 100,
        itemCount: 2,
        paymentCount: 1,
    });
});

test('summary construction is deterministic and reserved contract fields cannot be overridden', () => {
    const transaction = transactionFixture();
    const first = buildSalePostedPayload(transaction, {
        summary: { total: 999 },
        occurred_at: '2000-01-01T00:00:00.000Z',
        marker: 'offline',
    });
    const second = buildSalePostedPayload(transaction, { marker: 'offline' });

    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.summary.total, 100);
    assert.equal(first.occurred_at, '2026-08-22T19:38:20.050Z');
});

test('rejects total, line-count, payment-count and settlement mismatches as non-retryable', () => {
    const transaction = transactionFixture();
    const payload = buildSalePostedPayload(transaction);
    const invalid = {
        ...payload,
        transaction: {
            ...transaction,
            total: 110,
            settlementAppliedBase: 70,
        },
        summary: {
            ...payload.summary,
            item_count: 1,
            payment_count: 0,
        },
    };

    assert.throws(
        () => assertSalePostedPayload(invalid),
        (error: unknown) => {
            assert.ok(error instanceof SalePostedContractError);
            assert.equal(error.retryable, false);
            assert.match(error.message, /summary\.total=100 vs transaction\.total=110/);
            assert.match(error.message, /summary\.item_count=1 vs transaction\.items=2/);
            assert.match(error.message, /summary\.payment_count=0 vs transaction\.payments=1/);
            assert.match(error.message, /transaction\.total=110 vs settlement\+pending=95/);
            return true;
        },
    );
});

test('uses authoritative line totals instead of price times quantity for adjusted transactions', () => {
    const transaction = transactionFixture();
    assert.equal(buildSalePostedSummary(transaction).total, 100);
    assert.doesNotThrow(() => buildSalePostedPayload(transaction));

    const missingAuthoritativeTotal = {
        ...transaction,
        items: [{ id: 'item-adjusted', quantity: 2, price: 50, discountAmount: 5 }],
        total: 95,
        taxAmount: 0,
        netAmount: 95,
        discountAmount: 5,
        payments: [{ id: 'payment-1', amount: 95 }],
        settlementAppliedBase: 95,
        pendingBalance: 0,
    };
    assert.throws(() => buildSalePostedPayload(missingAuthoritativeTotal), (error: unknown) => {
        assert.ok(error instanceof SalePostedContractError);
        assert.match(error.message, /sin total financiero autoritativo/);
        assert.doesNotMatch(error.message, /lines\.total=0/);
        return true;
    });
});

test('freezes two-payment checkout lines before building SALE_POSTED', () => {
    const items = freezeAuthoritativeLineFiscalAmounts([
        { id: 'item-1', quantity: 1, price: 500 },
        { id: 'item-2', quantity: 1, price: 1750, discountAmount: 0 },
    ], { taxes: [], taxRate: 0 } as any, {
        transactionNetAmount: 2250,
        transactionTaxAmount: 0,
        transactionTotal: 2250,
    });
    const transaction = {
        id: 'TXN-SPLIT-PAYMENT',
        displayId: 'TCK-SPLIT-PAYMENT',
        documentType: 'TICKET',
        status: 'COMPLETED',
        date: '2026-08-23T08:42:12-04:00',
        total: 2250,
        netAmount: 2250,
        taxAmount: 0,
        discountAmount: 0,
        settlementAppliedBase: 2250,
        pendingBalance: 0,
        items,
        payments: [
            { id: 'cash', method: 'CASH', amount: 500 },
            { id: 'card', method: 'CARD', amount: 1750 },
        ],
    };

    assert.deepEqual(items.map(item => ({
        netAmount: item.netAmount,
        taxAmount: item.taxAmount,
        totalAmount: item.totalAmount,
    })), [
        { netAmount: 500, taxAmount: 0, totalAmount: 500 },
        { netAmount: 1750, taxAmount: 0, totalAmount: 1750 },
    ]);
    assert.deepEqual(assertSalePostedPayload(buildSalePostedPayload(transaction)), {
        transactionId: 'TXN-SPLIT-PAYMENT',
        total: 2250,
        lineTotal: 2250,
        itemCount: 2,
        paymentCount: 2,
    });
});

test('reconciles fiscal rounding and non-taxed charges on the final persisted line', () => {
    const items = freezeAuthoritativeLineFiscalAmounts([
        { id: 'item-1', quantity: 1, price: 50, appliedTaxIds: ['itbis'] },
        { id: 'item-2', quantity: 1, price: 50, appliedTaxIds: ['itbis'] },
    ], {
        taxes: [{ id: 'itbis', name: 'ITBIS', rate: 0.18, type: 'VAT' }],
        taxRate: 0.18,
    } as any, {
        isTaxIncluded: true,
        transactionNetAmount: 89.75,
        transactionTaxAmount: 15.25,
        transactionTotal: 105,
    });

    assert.equal(items.reduce((sum, item) => sum + item.netAmount, 0), 89.75);
    assert.equal(items.reduce((sum, item) => sum + item.taxAmount, 0), 15.25);
    assert.equal(items.reduce((sum, item) => sum + item.totalAmount, 0), 105);
    assert.equal(items[1].totalAmount, 55);
});
