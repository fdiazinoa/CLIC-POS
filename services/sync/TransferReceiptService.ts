import { v4 as uuidv4 } from 'uuid';
import type { BusinessConfig, StockTransfer, TerminalConfig } from '../../types';
import { db } from '../../utils/db';
import { resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { apiSyncAdapter } from './ApiSyncAdapter';

export const TRANSFER_RECEIPT_QUEUE_COLLECTION = 'transfer_receipt_queue';
export const TRANSFER_RECEIPT_QUEUE_UPDATED_EVENT = 'transferReceiptQueueUpdated';

export interface TransferReceiptLinePayload {
    transferItemId: string;
    quantity: number;
    discrepancyReason?: string;
}

export interface TransferReceiptPayload {
    terminal_id: string;
    device_id: string;
    idempotencyKey: string;
    lines: TransferReceiptLinePayload[];
    notes: string;
    closeWithDiscrepancy: false;
    evidence: unknown[];
}

export type TransferReceiptQueueStatus =
    | 'PENDING'
    | 'SENDING'
    | 'RETRY_WAIT'
    | 'APPLIED'
    | 'REJECTED';

export interface TransferReceiptQueueItem {
    id: string;
    transferId: string;
    destinationWarehouseId: string;
    payload: TransferReceiptPayload;
    status: TransferReceiptQueueStatus;
    attemptCount: number;
    nextRetryAt: string | null;
    createdAt: string;
    updatedAt: string;
    appliedAt?: string;
    rejectedAt?: string;
    lastError?: string;
    httpStatus?: number;
    result?: Record<string, unknown>;
    snapshotRefreshPending?: boolean;
    snapshotRefreshError?: string;
}

export interface CreateTransferReceiptInput {
    transfer: StockTransfer;
    terminalId: string;
    deviceId: string;
    authorizedWarehouseIds: string[];
    quantities: Record<string, number>;
    discrepancyReasons?: Record<string, string>;
    notes?: string;
    idempotencyKey?: string;
}

export interface TransferReceiptTransportResponse {
    httpStatus: number;
    data: Record<string, any>;
}

interface TransferReceiptStore {
    get(collection: string): Promise<unknown>;
    saveDocument(collection: string, document: Record<string, any>): Promise<void>;
}

interface TransferReceiptTransport {
    postTransferReceipt(transferId: string, payload: TransferReceiptPayload): Promise<TransferReceiptTransportResponse>;
}

type SnapshotRefresher = () => Promise<void>;

export class TransferReceiptValidationError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'TransferReceiptValidationError';
    }
}

const clean = (value: unknown): string => String(value || '').trim();

const finiteQuantity = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const computePendingQuantity = (quantity: unknown, receivedQuantity: unknown): number => {
    const sent = Number.isFinite(finiteQuantity(quantity)) ? finiteQuantity(quantity) : 0;
    const received = Number.isFinite(finiteQuantity(receivedQuantity)) ? finiteQuantity(receivedQuantity) : 0;
    return Math.max(sent - received, 0);
};

export const pendingTransferQuantity = computePendingQuantity;

export const buildTransferReceiptOperation = (input: CreateTransferReceiptInput): TransferReceiptQueueItem => {
    const transferId = clean(input.transfer.id);
    const terminalId = clean(input.terminalId);
    const deviceId = clean(input.deviceId);
    const destinationWarehouseId = clean(input.transfer.destinationWarehouseId);
    const authorized = new Set(input.authorizedWarehouseIds.map(clean).filter(Boolean));

    if (!transferId || !terminalId || !deviceId) {
        throw new TransferReceiptValidationError(
            'TRANSFER_RECEIPT_IDENTITY_MISSING',
            'No se pudo resolver terminal_id, device_id o transferId para confirmar la recepción.',
        );
    }
    if (authorized.size === 0) {
        throw new TransferReceiptValidationError(
            'TRANSFER_RECEIPT_WAREHOUSE_SCOPE_MISSING',
            'La terminal no tiene almacenes autorizados configurados.',
        );
    }
    if (!authorized.has(destinationWarehouseId)) {
        throw new TransferReceiptValidationError(
            'TRANSFER_RECEIPT_WAREHOUSE_FORBIDDEN',
            'Este traspaso pertenece a un almacén no autorizado para la terminal.',
        );
    }
    if (!['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(input.transfer.status)) {
        throw new TransferReceiptValidationError(
            'TRANSFER_RECEIPT_STATUS_INVALID',
            'El traspaso ya no está disponible para recepción.',
        );
    }

    const lines = (input.transfer.items || []).map((line) => {
        const transferItemId = clean(line.transferItemId);
        if (!transferItemId) {
            throw new TransferReceiptValidationError(
                'TRANSFER_RECEIPT_ITEM_ID_MISSING',
                `La línea ${clean(line.productName) || clean(line.productId)} no contiene transferItemId.`,
            );
        }

        const pending = computePendingQuantity(line.quantity, line.receivedQuantity);
        const quantity = finiteQuantity(input.quantities[transferItemId]);
        if (!Number.isFinite(quantity) || quantity < 0 || quantity > pending) {
            throw new TransferReceiptValidationError(
                'TRANSFER_RECEIPT_QUANTITY_INVALID',
                `La cantidad de ${clean(line.productName) || transferItemId} debe estar entre 0 y ${pending}.`,
            );
        }

        const discrepancyReason = clean(input.discrepancyReasons?.[transferItemId]);
        if (quantity < pending && !discrepancyReason) {
            throw new TransferReceiptValidationError(
                'TRANSFER_RECEIPT_REASON_REQUIRED',
                `Indique el motivo de la recepción parcial para ${clean(line.productName) || transferItemId}.`,
            );
        }

        return {
            transferItemId,
            quantity,
            ...(discrepancyReason ? { discrepancyReason } : {}),
        };
    }).filter((line) => {
        const source = input.transfer.items.find(item => clean(item.transferItemId) === line.transferItemId);
        return source ? computePendingQuantity(source.quantity, source.receivedQuantity) > 0 : false;
    });

    if (lines.length === 0 || !lines.some(line => line.quantity > 0)) {
        throw new TransferReceiptValidationError(
            'TRANSFER_RECEIPT_EMPTY',
            'Debe recibir al menos una unidad pendiente.',
        );
    }

    const idempotencyKey = clean(input.idempotencyKey) || uuidv4();
    const now = new Date().toISOString();
    const payload: TransferReceiptPayload = {
        terminal_id: terminalId,
        device_id: deviceId,
        idempotencyKey,
        lines,
        notes: clean(input.notes),
        closeWithDiscrepancy: false,
        evidence: [],
    };

    return {
        id: idempotencyKey,
        transferId,
        destinationWarehouseId,
        payload,
        status: 'PENDING',
        attemptCount: 0,
        nextRetryAt: null,
        createdAt: now,
        updatedAt: now,
        snapshotRefreshPending: false,
    };
};

const readHttpStatus = (error: unknown): number | null => {
    const direct = Number((error as any)?.httpStatus ?? (error as any)?.status);
    if (Number.isInteger(direct) && direct >= 100 && direct <= 599) return direct;
    const message = error instanceof Error ? error.message : String(error || '');
    const match = message.match(/(?:HTTP|failed(?: after re-auth)?):?\s*(\d{3})/i);
    return match ? Number(match[1]) : null;
};

const errorMessage = (error: unknown): string => (
    error instanceof Error ? error.message : String(error || 'Error desconocido')
);

export const isNonRetryableTransferReceiptError = (error: unknown): boolean => {
    const status = readHttpStatus(error);
    return status !== null && status >= 400 && status < 500;
};

const backoffDelayMs = (attemptCount: number): number => (
    Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, attemptCount - 1)))
);

const defaultSnapshotRefresher: SnapshotRefresher = async () => {
    const { syncManager } = await import('./SyncManager');
    await syncManager.pullCatalog('transfers', true, { ignoreThrottle: true });
    await syncManager.pullCatalog('productStocks', true, { ignoreThrottle: true });
    window.dispatchEvent(new CustomEvent('transfersUpdated'));
    window.dispatchEvent(new CustomEvent('productStocksUpdated'));
};

export class TransferReceiptService {
    private processing: Promise<TransferReceiptQueueItem[]> | null = null;
    private readonly enqueueInFlight = new Set<string>();

    constructor(
        private readonly store: TransferReceiptStore = db as unknown as TransferReceiptStore,
        private readonly transport: TransferReceiptTransport = apiSyncAdapter,
        private readonly refreshSnapshot: SnapshotRefresher = defaultSnapshotRefresher,
        private readonly now: () => Date = () => new Date(),
    ) {}

    async list(): Promise<TransferReceiptQueueItem[]> {
        const records = await this.store.get(TRANSFER_RECEIPT_QUEUE_COLLECTION);
        return (Array.isArray(records) ? records : [])
            .filter(Boolean)
            .map(record => record as TransferReceiptQueueItem)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }

    async enqueue(input: CreateTransferReceiptInput): Promise<TransferReceiptQueueItem> {
        const transferId = clean(input.transfer.id);
        if (this.enqueueInFlight.has(transferId)) {
            throw new TransferReceiptValidationError(
                'TRANSFER_RECEIPT_ALREADY_QUEUED',
                'Ya hay una confirmación de recepción en proceso para este traspaso.',
            );
        }
        this.enqueueInFlight.add(transferId);
        try {
            const existing = (await this.list()).find(item => (
                item.transferId === transferId
                && ['PENDING', 'SENDING', 'RETRY_WAIT'].includes(item.status)
            ));
            if (existing) {
                throw new TransferReceiptValidationError(
                    'TRANSFER_RECEIPT_ALREADY_QUEUED',
                    'Ya hay una confirmación pendiente de sincronización para este traspaso.',
                );
            }
            const operation = buildTransferReceiptOperation(input);
            await this.store.saveDocument(TRANSFER_RECEIPT_QUEUE_COLLECTION, operation as unknown as Record<string, any>);
            this.notify();
            return operation;
        } finally {
            this.enqueueInFlight.delete(transferId);
        }
    }

    async recoverInterrupted(): Promise<number> {
        const queue = await this.list();
        let recovered = 0;
        for (const item of queue) {
            if (item.status !== 'SENDING') continue;
            await this.persist({
                ...item,
                status: 'RETRY_WAIT',
                nextRetryAt: this.now().toISOString(),
                updatedAt: this.now().toISOString(),
                lastError: item.lastError || 'INTERRUPTED_BEFORE_ACK',
            });
            recovered += 1;
        }
        if (recovered > 0) this.notify();
        return recovered;
    }

    async processDue(): Promise<TransferReceiptQueueItem[]> {
        if (this.processing) return this.processing;
        this.processing = this.processDueInternal().finally(() => {
            this.processing = null;
        });
        return this.processing;
    }

    private async processDueInternal(): Promise<TransferReceiptQueueItem[]> {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.list();

        const queue = await this.list();
        for (const item of queue) {
            if (item.status === 'APPLIED' && item.snapshotRefreshPending) {
                await this.retrySnapshotRefresh(item);
                continue;
            }
            if (!['PENDING', 'RETRY_WAIT'].includes(item.status)) continue;
            if (item.nextRetryAt && Date.parse(item.nextRetryAt) > this.now().getTime()) continue;
            await this.send(item);
        }
        this.notify();
        return this.list();
    }

    private async send(item: TransferReceiptQueueItem): Promise<void> {
        if (item.payload.closeWithDiscrepancy !== false) {
            await this.persist({
                ...item,
                status: 'REJECTED',
                rejectedAt: this.now().toISOString(),
                updatedAt: this.now().toISOString(),
                nextRetryAt: null,
                lastError: 'TRANSFER_RECEIPT_CLOSE_WITH_DISCREPANCY_FORBIDDEN',
            });
            return;
        }

        const sending: TransferReceiptQueueItem = {
            ...item,
            status: 'SENDING',
            attemptCount: item.attemptCount + 1,
            nextRetryAt: null,
            updatedAt: this.now().toISOString(),
            lastError: undefined,
        };
        await this.persist(sending);

        try {
            const response = await this.transport.postTransferReceipt(sending.transferId, sending.payload);
            if (response.httpStatus !== 200 && response.httpStatus !== 201) {
                const error = new Error(`Transfer receipt failed: ${response.httpStatus}`) as Error & { httpStatus: number };
                error.httpStatus = response.httpStatus;
                throw error;
            }
            const applied: TransferReceiptQueueItem = {
                ...sending,
                status: 'APPLIED',
                appliedAt: this.now().toISOString(),
                updatedAt: this.now().toISOString(),
                nextRetryAt: null,
                lastError: undefined,
                httpStatus: response.httpStatus,
                result: response.data?.result || response.data,
                snapshotRefreshPending: true,
                snapshotRefreshError: undefined,
            };
            await this.persist(applied);
            await this.retrySnapshotRefresh(applied);
        } catch (error) {
            const status = readHttpStatus(error);
            const next = isNonRetryableTransferReceiptError(error)
                ? {
                    ...sending,
                    status: 'REJECTED' as const,
                    rejectedAt: this.now().toISOString(),
                    updatedAt: this.now().toISOString(),
                    nextRetryAt: null,
                    lastError: errorMessage(error),
                    ...(status ? { httpStatus: status } : {}),
                }
                : {
                    ...sending,
                    status: 'RETRY_WAIT' as const,
                    updatedAt: this.now().toISOString(),
                    nextRetryAt: new Date(this.now().getTime() + backoffDelayMs(sending.attemptCount)).toISOString(),
                    lastError: errorMessage(error),
                    ...(status ? { httpStatus: status } : {}),
                };
            await this.persist(next);
        }
    }

    private async retrySnapshotRefresh(item: TransferReceiptQueueItem): Promise<void> {
        try {
            await this.refreshSnapshot();
            await this.persist({
                ...item,
                snapshotRefreshPending: false,
                snapshotRefreshError: undefined,
                updatedAt: this.now().toISOString(),
            });
        } catch (error) {
            await this.persist({
                ...item,
                snapshotRefreshPending: true,
                snapshotRefreshError: errorMessage(error),
                updatedAt: this.now().toISOString(),
            });
        }
    }

    private async persist(item: TransferReceiptQueueItem): Promise<void> {
        await this.store.saveDocument(TRANSFER_RECEIPT_QUEUE_COLLECTION, item as unknown as Record<string, any>);
    }

    private notify(): void {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent(TRANSFER_RECEIPT_QUEUE_UPDATED_EVENT));
    }
}

export const resolveTransferReceiptTerminalContext = (
    config: BusinessConfig,
    localTerminalId?: string,
): { terminalId: string; deviceId: string; authorizedWarehouseIds: string[] } => {
    const localDeviceId = clean(resolveLocalDeviceId());
    const terminal = (config.terminals || []).find(candidate => (
        clean(candidate.id) === clean(localTerminalId)
        || clean(candidate.config?.currentDeviceId) === localDeviceId
        || clean(candidate.config?.erpTerminalId) === clean(localTerminalId)
        || clean(candidate.config?.erpBinding?.terminalId) === clean(localTerminalId)
    ));
    const terminalConfig = terminal?.config as TerminalConfig | undefined;
    const terminalId = clean(
        terminalConfig?.erpBinding?.terminalId
        || terminalConfig?.erpTerminalId
        || terminal?.id
        || localTerminalId,
    );
    const deviceId = clean(localDeviceId || terminalConfig?.currentDeviceId || terminalConfig?.erpBinding?.deviceId);
    const inventoryScope = terminalConfig?.inventoryScope;
    const authorizedWarehouseIds = Array.from(new Set([
        ...(inventoryScope?.visibleWarehouseIds || []),
        inventoryScope?.defaultSalesWarehouseId,
        inventoryScope?.transferWarehouseId,
    ].map(clean).filter(Boolean)));

    return { terminalId, deviceId, authorizedWarehouseIds };
};

export const transferReceiptService = new TransferReceiptService();
