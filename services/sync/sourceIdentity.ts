import { CashMovement, PaymentEntry, Transaction, ZReport } from '../../types';

const SOURCE_CHANNEL = 'POS' as const;

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
    return payments.map((payment) => ({
        ...payment,
        source_channel: SOURCE_CHANNEL,
        source_payment_id: normalizeString(payment?.source_payment_id) || normalizeString(payment?.id),
        source_transaction_id: context.sourceTransactionId,
        source_display_id: context.sourceDisplayId,
        source_terminal_id: context.sourceTerminalId,
        device_id: context.deviceId
    }));
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
