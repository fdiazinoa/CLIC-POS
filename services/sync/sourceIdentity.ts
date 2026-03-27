import { CashMovement, InventoryLedgerEntry, PaymentEntry, Transaction, ZReport } from '../../types';

const SOURCE_CHANNEL = 'POS' as const;
const DEFAULT_CURRENCY = 'DOP';

const normalizeString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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

        return {
            ...payment,
            source_channel: SOURCE_CHANNEL,
            source_payment_id: normalizeString(payment?.source_payment_id) || normalizeString(payment?.id),
            source_transaction_id: context.sourceTransactionId,
            source_display_id: context.sourceDisplayId,
            source_terminal_id: context.sourceTerminalId,
            device_id: context.deviceId,
            payment_method: payment?.payment_method ?? payment?.method,
            currency_code: currencyCode,
            exchange_rate: exchangeRate
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
