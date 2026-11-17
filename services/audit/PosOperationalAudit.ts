import { v4 as uuid } from 'uuid';
import type { AuditLogEntry, BusinessConfig, InvoiceAuditEvent, SyncStatus, User } from '../../types';
import type { DatabaseAdapter } from '../db/DatabaseAdapter';

export const POS_AUDIT_COLLECTION = 'posAuditEvents';
export interface PosAuditQueueItem {
    id: string;
    schemaVersion: 1;
    kind: 'AUTHORIZATION';
    terminalId: string;
    timestamp: string;
    syncStatus: SyncStatus;
    event: AuditLogEntry;
}
export const buildAuthorizationLog = (cashier: User, supervisor: User, params: {
    permission: AuditLogEntry['actionType']; actionDescription: string;
    context?: { ticketId?: string; itemId?: string; originalValue?: number; newValue?: number; reason?: string };
}, terminalId: string): AuditLogEntry => ({
    id: uuid(), timestamp: new Date().toISOString(), actionType: params.permission,
    actionDescription: params.actionDescription, cashierId: cashier.id, cashierName: cashier.name,
    supervisorId: supervisor.id, supervisorName: supervisor.name, terminalId,
    ...params.context, hash: '', auditSyncVersion: 1,
    details: [params.actionDescription, params.context?.reason].filter(Boolean).join(' | '),
});
export const authorizationQueueItem = (log: AuditLogEntry): PosAuditQueueItem => ({
    id: log.id, schemaVersion: 1, kind: 'AUTHORIZATION', terminalId: log.terminalId,
    timestamp: log.timestamp, syncStatus: 'PENDING', event: log,
});
const actualTerminal = (value: string) => Boolean(value && !['LOCAL', 'current-terminal'].includes(value));
let writeTail: Promise<unknown> = Promise.resolve();

/** Local persistence only. Network is deliberately left to the background worker. */
export function persistAuthorizationLog(database: DatabaseAdapter, config: BusinessConfig, log: AuditLogEntry): Promise<string | null> {
    const run = async () => {
        try {
            if (!actualTerminal(log.terminalId)) throw new Error('POS_AUDIT_TERMINAL_PENDING');
            await database.saveDocument(POS_AUDIT_COLLECTION, authorizationQueueItem(log));
            return null;
        } catch {
            log.auditRecoveryPending = true;
            // Retain a marked backup when queue storage fails. Do not replace current config
            // fields with a stale React snapshot or invent a terminal for historical logs.
            try {
                const stored = await database.getDocument<BusinessConfig & { id: string }>('config', 'current');
                const current = stored || config;
                const logs = [...(current.auditLogs || [])];
                if (!logs.some(entry => entry.id === log.id)) logs.push(log);
                await database.saveDocument('config', { ...current, id: 'current', auditLogs: logs });
                return 'La autorización se conservó localmente; la auditoría ERP queda pendiente de recuperación.';
            } catch {
                return 'No se pudo guardar la auditoría de esta autorización. Revisa el almacenamiento del POS; el envío ERP no está confirmado.';
            }
        }
    };
    const result = writeTail.then(run, run);
    writeTail = result.catch(() => undefined);
    return result;
}

/** Recover only logs emitted by this version. Atomic insert never downgrades an ACK. */
export async function reconcileAuthorizationBackups(database: DatabaseAdapter, terminalId: string): Promise<void> {
    if (!actualTerminal(terminalId) || !database.saveDocumentsAtomically) return;
    const config = await database.getDocument<BusinessConfig>('config', 'current');
    for (const log of config?.auditLogs || []) {
        if (log.auditSyncVersion !== 1 || !log.auditRecoveryPending || log.terminalId !== terminalId || !actualTerminal(log.terminalId)) continue;
        const receipt = { id: `pos-audit-recovered:${log.id}`, sourceEventId: log.id, kind: 'POS_AUDIT_RECOVERY_RECEIPT' };
        if (await database.getDocument('syncMetadata', receipt.id)) continue;
        if (await database.getDocument(POS_AUDIT_COLLECTION, log.id)) {
            await database.saveDocument('syncMetadata', receipt);
            continue;
        }
        try {
            await database.saveDocumentsAtomically([{ collectionName: POS_AUDIT_COLLECTION, document: authorizationQueueItem(log) }, { collectionName: 'syncMetadata', document: receipt }], true);
        } catch (error) {
            if (!await database.getDocument(POS_AUDIT_COLLECTION, log.id)) throw error;
            await database.saveDocument('syncMetadata', receipt);
        }
    }
}

/** Explicit wire allowlist: no PIN, credentials, hashes, mutable queue status or full invoice. */
export function posAuditWireItem(item: PosAuditQueueItem | InvoiceAuditEvent, invoice = false) {
    if (invoice) {
        const event = item as InvoiceAuditEvent;
        return { schemaVersion: 1, kind: 'INVOICE', event: {
            id: event.id, idempotencyKey: event.idempotencyKey, terminalId: event.terminalId,
            tenantId: event.tenantId, companyId: event.companyId, storeId: event.storeId,
            actorId: event.actorId, actorName: event.actorName, authorizedById: event.authorizedById,
            authorizedByName: event.authorizedByName, eventType: event.eventType,
            transactionId: event.transactionId, transactionDisplayId: event.transactionDisplayId,
            occurredAt: event.occurredAt, reason: event.reason,
        } };
    }
    const event = (item as PosAuditQueueItem).event;
    return { schemaVersion: 1, kind: 'AUTHORIZATION', event: {
        id: event.id, timestamp: event.timestamp, terminalId: event.terminalId,
        cashierId: event.cashierId, cashierName: event.cashierName,
        supervisorId: event.supervisorId, supervisorName: event.supervisorName,
        actionType: event.actionType, actionDescription: event.actionDescription,
        ticketId: event.ticketId, itemId: event.itemId, originalValue: event.originalValue,
        newValue: event.newValue, reason: event.reason,
    } };
}
export function assertPosAuditAcknowledgement(response: unknown, eventId: string): void {
    const body = response as { status?: string; results?: Array<{ eventId?: string; auditId?: string; disposition?: string }> };
    if (body?.status !== 'success' || !body.results?.some(result => result.eventId === eventId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.auditId || '') && result.disposition === 'RECORDED')) throw new Error('POS_AUDIT_ACK_NOT_DURABLE');
}
