import { CashMovement, CartItem, InventoryLedgerEntry, PaymentEntry, Transaction, ZReport } from '../../types';

const SOURCE_CHANNEL = 'POS' as const;
const DEFAULT_CURRENCY = 'DOP';

const normalizeString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const normalizeNumber = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeTransactionItems = (items: CartItem[]): CartItem[] => {
    return items.map((item) => {
        const price = Number(item?.price || 0);
        const quantity = Number(item?.quantity || 0);
        const originalPriceRaw = item?.originalPrice;
        const originalPrice = typeof originalPriceRaw === 'number' && Number.isFinite(originalPriceRaw)
            ? originalPriceRaw
            : undefined;
        const effectiveOriginalPrice = (typeof originalPrice === 'number' && originalPrice > 0 && originalPrice !== price)
            ? originalPrice
            : undefined;
        const derivedDiscountAmount = effectiveOriginalPrice && price < effectiveOriginalPrice
            ? round2((effectiveOriginalPrice - price) * quantity)
            : undefined;
        const derivedDiscountRate = effectiveOriginalPrice && price < effectiveOriginalPrice && effectiveOriginalPrice > 0
            ? round4((effectiveOriginalPrice - price) / effectiveOriginalPrice)
            : undefined;
        const netAmount = normalizeNumber(item?.netAmount);
        const taxAmount = normalizeNumber(item?.taxAmount);
        const totalAmount = normalizeNumber(item?.totalAmount);
        const taxRate = normalizeNumber(item?.taxRate);

        return {
            ...item,
            price,
            quantity,
            originalPrice: effectiveOriginalPrice,
            discountAmount: derivedDiscountAmount ?? item.discountAmount,
            discountRate: derivedDiscountRate ?? item.discountRate,
            netAmount,
            taxAmount,
            totalAmount,
            taxRate,
            appliedPromotionCode: item.appliedPromotionCode || item.appliedPromotionId,
            appliedPromotionName: item.appliedPromotionName
        };
    });
};

const resolveDeviceId = (): string | undefined => {
    if (typeof window === 'undefined') return undefined;

    try {
        return normalizeString(localStorage.getItem('pos_device_id'));
    } catch (error) {
        console.warn('⚠️ sourceIdentity: Failed to resolve device id from storage:', error);
        return undefined;
    }
};

const normalizePaymentEntries = (
    payments: any[],
    context: {
        sourceTransactionId: string;
        sourceDisplayId?: string;
        sourceTerminalId?: string;
        deviceId?: string;
    }
): PaymentEntry[] => {
    return payments.map((payment) => {
        const currencyCode =
            normalizeString(payment?.currency_code) ||
            normalizeString(payment?.currencyCode) ||
            DEFAULT_CURRENCY;
        const exchangeRateRaw = payment?.exchange_rate ?? payment?.exchangeRate;
        const exchangeRate =
            typeof exchangeRateRaw === 'number' && !Number.isNaN(exchangeRateRaw) ? exchangeRateRaw : undefined;
        const appliedAmountRaw = Number(payment?.applied_amount ?? payment?.appliedAmount ?? payment?.amountApplied);
        const appliedAmount =
            Number.isFinite(appliedAmountRaw) ? appliedAmountRaw : undefined;
        const changeAmountRaw = Number(payment?.change_amount ?? payment?.changeAmount);
        const changeAmount =
            Number.isFinite(changeAmountRaw) ? changeAmountRaw : undefined;
        const changeCurrencyCode =
            normalizeString(payment?.change_currency_code) ||
            normalizeString(payment?.changeCurrencyCode);

        // Sync only the minimal payment shape required by master/ERP.
        // Integrated card metadata stays in the local sale, but should not block
        // slave->master forwarding when processors attach verbose gateway fields.
        const paymentForSync: PaymentEntry = {
            id: normalizeString(payment?.id) || normalizeString(payment?.source_payment_id) || `${context.sourceTransactionId}-payment`,
            method: (payment?.method || payment?.payment_method || 'OTHER') as PaymentEntry['method'],
            methodId: normalizeString(payment?.methodId),
            methodLabel: normalizeString(payment?.methodLabel),
            methodIcon: normalizeString(payment?.methodIcon),
            creditOverrideApproved: Boolean(payment?.creditOverrideApproved),
            amount: Number(payment?.amount || 0),
            timestamp: payment?.timestamp instanceof Date
                ? payment.timestamp
                : new Date(payment?.timestamp || new Date().toISOString()),
            currencyCode,
            amountOriginal: typeof payment?.amountOriginal === 'number' ? payment.amountOriginal : undefined,
            exchangeRate,
            appliedAmount,
            changeAmount,
            changeCurrencyCode,
            amountApplied: appliedAmount,
        };

        return {
            ...paymentForSync,
            source_channel: SOURCE_CHANNEL,
            source_payment_id: normalizeString(payment?.source_payment_id) || normalizeString(payment?.id),
            source_transaction_id: context.sourceTransactionId,
            source_display_id: context.sourceDisplayId,
            source_terminal_id: context.sourceTerminalId,
            device_id: context.deviceId,
            payment_method: payment?.payment_method ?? payment?.method,
            currency_code: currencyCode,
            exchange_rate: exchangeRate,
            appliedAmount,
            amountApplied: appliedAmount,
            applied_amount: appliedAmount,
            changeAmount,
            change_amount: changeAmount,
            changeCurrencyCode,
            change_currency_code: changeCurrencyCode
        };
    });
};

export const normalizeTransactionForSync = (transaction: Transaction): Transaction => {
    const sourceTransactionId =
        normalizeString((transaction as any).source_transaction_id) ||
        normalizeString(transaction.id);

    if (!sourceTransactionId) {
        throw new Error('Transaction is missing a persistent technical ID');
    }

    const sourceDisplayId =
        normalizeString((transaction as any).source_display_id) ||
        normalizeString(transaction.displayId);

    const sourceTerminalId =
        normalizeString((transaction as any).source_terminal_id) ||
        normalizeString(transaction.terminalId);

    const deviceId =
        normalizeString((transaction as any).device_id) ||
        resolveDeviceId();

    const originalTransactionId =
        normalizeString((transaction as any).original_transaction_id) ||
        normalizeString(transaction.originalTransactionId);

    const originalDisplayId =
        normalizeString((transaction as any).original_display_id) ||
        normalizeString(transaction.affectedInvoiceNumber);

    const isCreditNote = transaction.documentType === 'REFUND' || transaction.ncfType === 'B04';
    const sourceCreditNoteId =
        isCreditNote
            ? (normalizeString((transaction as any).source_credit_note_id) || sourceTransactionId)
            : undefined;
    const settlementCurrencyCode =
        normalizeString((transaction as any).settlement_currency_code) ||
        normalizeString((transaction as any).settlementCurrencyCode);
    const settlementExchangeRateRaw =
        (transaction as any).settlement_exchange_rate ??
        (transaction as any).settlementExchangeRate;
    const settlementExchangeRateValue = Number(settlementExchangeRateRaw);
    const settlementExchangeRate =
        Number.isFinite(settlementExchangeRateValue)
            ? settlementExchangeRateValue
            : undefined;
    const settlementReceivedOriginalRaw =
        (transaction as any).settlement_received_original ??
        (transaction as any).settlementReceivedOriginal;
    const settlementReceivedOriginalValue = Number(settlementReceivedOriginalRaw);
    const settlementReceivedOriginal =
        Number.isFinite(settlementReceivedOriginalValue)
            ? settlementReceivedOriginalValue
            : undefined;
    const settlementReceivedBaseRaw =
        (transaction as any).settlement_received_base ??
        (transaction as any).settlementReceivedBase;
    const settlementReceivedBaseValue = Number(settlementReceivedBaseRaw);
    const settlementReceivedBase =
        Number.isFinite(settlementReceivedBaseValue)
            ? settlementReceivedBaseValue
            : undefined;
    const settlementAppliedBaseRaw =
        (transaction as any).settlement_applied_base ??
        (transaction as any).settlementAppliedBase;
    const settlementAppliedBaseValue = Number(settlementAppliedBaseRaw);
    const settlementAppliedBase =
        Number.isFinite(settlementAppliedBaseValue)
            ? settlementAppliedBaseValue
            : undefined;
    const settlementChangeBaseRaw =
        (transaction as any).settlement_change_base ??
        (transaction as any).settlementChangeBase;
    const settlementChangeBaseValue = Number(settlementChangeBaseRaw);
    const settlementChangeBase =
        Number.isFinite(settlementChangeBaseValue)
            ? settlementChangeBaseValue
            : undefined;
    const settlementChangeCurrencyCode =
        normalizeString((transaction as any).settlement_change_currency_code) ||
        normalizeString((transaction as any).settlementChangeCurrencyCode);

    return {
        ...transaction,
        source_channel: SOURCE_CHANNEL,
        source_transaction_id: sourceTransactionId,
        source_display_id: sourceDisplayId,
        source_terminal_id: sourceTerminalId,
        device_id: deviceId,
        source_credit_note_id: sourceCreditNoteId,
        original_transaction_id: originalTransactionId,
        original_display_id: originalDisplayId,
        settlementCurrencyCode,
        settlementExchangeRate,
        settlementReceivedOriginal,
        settlementReceivedBase,
        settlementAppliedBase,
        settlementChangeBase,
        settlementChangeCurrencyCode,
        settlement_currency_code: settlementCurrencyCode,
        settlement_exchange_rate: settlementExchangeRate,
        settlement_received_original: settlementReceivedOriginal,
        settlement_received_base: settlementReceivedBase,
        settlement_applied_base: settlementAppliedBase,
        settlement_change_base: settlementChangeBase,
        settlement_change_currency_code: settlementChangeCurrencyCode,
        items: normalizeTransactionItems(Array.isArray(transaction.items) ? transaction.items : []),
        payments: normalizePaymentEntries(Array.isArray(transaction.payments) ? transaction.payments : [], {
            sourceTransactionId,
            sourceDisplayId,
            sourceTerminalId,
            deviceId
        })
    };
};

export const normalizeCashMovementForSync = (movement: CashMovement): CashMovement => {
    const sourceCashMovementId =
        normalizeString((movement as any).source_cash_movement_id) ||
        normalizeString(movement.id);

    if (!sourceCashMovementId) {
        throw new Error('Cash movement is missing a persistent technical ID');
    }

    const sourceTerminalId =
        normalizeString((movement as any).source_terminal_id) ||
        normalizeString(movement.terminalId);

    const deviceId =
        normalizeString((movement as any).device_id) ||
        resolveDeviceId();

    const createdAt =
        normalizeString((movement as any).created_at) ||
        normalizeString((movement as any).createdAt) ||
        normalizeString(movement.timestamp);

    return {
        ...movement,
        source_channel: SOURCE_CHANNEL,
        source_cash_movement_id: sourceCashMovementId,
        source_terminal_id: sourceTerminalId,
        device_id: deviceId,
        created_at: createdAt
    };
};

export const normalizeInventoryLedgerForSync = (entry: InventoryLedgerEntry): InventoryLedgerEntry => {
    const sourceInventoryMovementId =
        normalizeString((entry as any).source_inventory_movement_id) || normalizeString(entry.id);

    if (!sourceInventoryMovementId) {
        throw new Error('Inventory ledger entry is missing a persistent technical ID');
    }

    const sourceTerminalId =
        normalizeString((entry as any).source_terminal_id) || normalizeString(entry.terminalId);

    const deviceId = normalizeString((entry as any).device_id) || resolveDeviceId();

    const createdAt =
        normalizeString((entry as any).created_at) || normalizeString(entry.createdAt);

    return {
        ...entry,
        source_channel: SOURCE_CHANNEL,
        source_inventory_movement_id: sourceInventoryMovementId,
        source_terminal_id: sourceTerminalId,
        device_id: deviceId,
        created_at: createdAt
    };
};

/** Wallet row from `wallet_transactions`: stable `id` is the technical source_event_id. */
export const normalizeWalletEventForSync = (event: Record<string, unknown>): Record<string, unknown> => {
    const sourceEventId =
        normalizeString(event.source_event_id as string) || normalizeString(event.id as string);

    if (!sourceEventId) {
        throw new Error('Wallet event is missing a persistent technical ID');
    }

    const sourceTerminalId =
        normalizeString(event.source_terminal_id as string) || normalizeString((event as any).terminalId);

    const deviceId = normalizeString(event.device_id as string) || resolveDeviceId();

    const createdAt =
        normalizeString(event.created_at as string) ||
        normalizeString((event as any).createdAt) ||
        new Date().toISOString();

    const sourceTransactionId =
        normalizeString((event as any).source_transaction_id) ||
        normalizeString((event as any).referenceId);

    return {
        ...event,
        source_channel: SOURCE_CHANNEL,
        source_event_id: sourceEventId,
        source_terminal_id: sourceTerminalId,
        device_id: deviceId,
        source_transaction_id: sourceTransactionId,
        event_type: (event.event_type as string) || 'WALLET',
        amount: typeof (event as any).amount === 'number' ? (event as any).amount : undefined,
        created_at: createdAt
    };
};

/** Loyalty operational events (points earn/burn); stable `id` is source_event_id. */
export const normalizeLoyaltyEventForSync = (event: Record<string, unknown>): Record<string, unknown> => {
    const sourceEventId =
        normalizeString(event.source_event_id as string) || normalizeString(event.id as string);

    if (!sourceEventId) {
        throw new Error('Loyalty event is missing a persistent technical ID');
    }

    const sourceTerminalId =
        normalizeString(event.source_terminal_id as string) || normalizeString((event as any).terminalId);

    const deviceId = normalizeString(event.device_id as string) || resolveDeviceId();

    const createdAt =
        normalizeString(event.created_at as string) ||
        normalizeString((event as any).createdAt) ||
        new Date().toISOString();

    const sourceTransactionId =
        normalizeString((event as any).source_transaction_id) || normalizeString((event as any).referenceId);

    const pointsRaw = (event as any).points ?? (event as any).amount;
    const points = typeof pointsRaw === 'number' && !Number.isNaN(pointsRaw) ? pointsRaw : undefined;

    return {
        ...event,
        source_channel: SOURCE_CHANNEL,
        source_event_id: sourceEventId,
        source_terminal_id: sourceTerminalId,
        device_id: deviceId,
        source_transaction_id: sourceTransactionId,
        event_type: (event.event_type as string) || 'LOYALTY_POINTS',
        points,
        created_at: createdAt
    };
};

export const normalizeZReportForSync = (report: ZReport): ZReport => {
    const sourceZReportId =
        normalizeString((report as any).source_z_report_id) ||
        normalizeString(report.id);

    if (!sourceZReportId) {
        throw new Error('Z report is missing a persistent technical ID');
    }

    const sourceTerminalId =
        normalizeString((report as any).source_terminal_id) ||
        normalizeString(report.terminalId);

    const deviceId =
        normalizeString((report as any).device_id) ||
        resolveDeviceId();

    return {
        ...report,
        source_channel: SOURCE_CHANNEL,
        source_z_report_id: sourceZReportId,
        source_terminal_id: sourceTerminalId,
        device_id: deviceId
    };
};
