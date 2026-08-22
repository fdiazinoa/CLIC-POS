import type {
    DatabaseAdapter,
    DurableOutboxStatus,
    FinancialCommitInput,
} from '../db/DatabaseAdapter';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { dbAdapter } from '../db';
import { syncMetrics } from './SyncMetrics';
import {
    assertSalePostedPayload,
    buildSalePostedPayload,
    SalePostedContractError,
} from './SalePostedContract';

export interface DurableOutboxRecord {
    localSequence: number;
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    schemaVersion: number;
    payload: Record<string, any>;
    status: DurableOutboxStatus;
    attemptCount: number;
    nextRetryAt: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    createdAt: string;
    updatedAt: string;
    lastError: string | null;
}

const rowsFromResult = (result: any): Record<string, any>[] => {
    if (!Array.isArray(result) || result.length === 0) return [];
    const first = result[0];
    if (!Array.isArray(first?.columns) || !Array.isArray(first?.values)) return [];
    return first.values.map((values: any[]) => first.columns.reduce((row: Record<string, any>, column: string, index: number) => {
        row[column] = values[index];
        return row;
    }, {}));
};

const mapRecord = (row: Record<string, any>): DurableOutboxRecord => ({
    localSequence: Number(row.local_sequence || 0),
    eventId: String(row.event_id || ''),
    eventType: String(row.event_type || ''),
    aggregateType: String(row.aggregate_type || ''),
    aggregateId: String(row.aggregate_id || ''),
    schemaVersion: Number(row.schema_version || 0),
    payload: JSON.parse(String(row.payload_json || '{}')),
    status: row.status as DurableOutboxStatus,
    attemptCount: Number(row.attempt_count || 0),
    nextRetryAt: row.next_retry_at || null,
    leaseOwner: row.lease_owner || null,
    leaseExpiresAt: row.lease_expires_at || null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    lastError: row.last_error || null,
});

export class DurableOutboxRepository {
    constructor(private readonly database: DatabaseAdapter = dbAdapter) {}

    isSupported(): boolean {
        return typeof this.database.commitFinancialTransaction === 'function'
            && typeof this.database.executeSQL === 'function';
    }

    async commitFinancialTransaction(input: FinancialCommitInput): Promise<void> {
        if (!this.database.commitFinancialTransaction) {
            throw new Error('El adaptador activo no soporta commit financiero SQLite atómico.');
        }
        if (input.outboxEvent.eventType.trim().toUpperCase() === 'SALE_POSTED') {
            try {
                assertSalePostedPayload(input.outboxEvent.payload);
            } catch (error) {
                console.error('[SALE_POSTED_CONTRACT_INVALID] Evento financiero no persistido.', {
                    eventId: input.outboxEvent.eventId,
                    aggregateId: input.outboxEvent.aggregateId,
                    code: error instanceof SalePostedContractError ? error.code : 'SALE_POSTED_VALIDATION_FAILED',
                    details: error instanceof SalePostedContractError ? error.details : [String(error)],
                });
                throw error;
            }
        }
        await this.database.commitFinancialTransaction(input);
        await this.refreshMetrics();
    }

    async recoverExpiredLeases(now = new Date()): Promise<number> {
        const sql = this.requireSql();
        const timestamp = now.toISOString();
        const result = await sql(
            `UPDATE sync_outbox_v2
             SET status = 'RETRY_WAIT',
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 next_retry_at = ?,
                 updated_at = ?,
                 last_error = COALESCE(last_error, 'LEASE_EXPIRED')
             WHERE status = 'SENDING'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= ?`,
            [timestamp, timestamp, timestamp]
        );
        await this.refreshMetrics();
        return Number(result?.changes?.changes ?? result?.changes ?? 0);
    }

    async repairLegacyEventContracts(now = new Date()): Promise<number> {
        const sql = this.requireSql();
        const result = await sql(
            `SELECT outbox.local_sequence, outbox.event_id, outbox.event_type,
                    outbox.aggregate_type, outbox.aggregate_id, outbox.payload_json,
                    documents.data AS transaction_json
             FROM sync_outbox_v2 AS outbox
             LEFT JOIN documents
               ON documents.collection_name = 'transactions'
              AND documents.doc_id = outbox.aggregate_id
             WHERE outbox.status IN ('PENDING','RETRY_WAIT')
             ORDER BY outbox.local_sequence ASC`
        );
        const pendingRows = rowsFromResult(result);
        const timestamp = now.toISOString();
        let changed = 0;

        for (const row of pendingRows) {
            const eventId = String(row.event_id || '');
            const eventType = String(row.event_type || '').trim().toUpperCase();
            const isTransaction = String(row.aggregate_type || '').trim().toUpperCase() === 'TRANSACTION';
            let payload: Record<string, any>;
            try {
                payload = JSON.parse(String(row.payload_json || '{}')) as Record<string, any>;
            } catch {
                await sql(
                    `UPDATE sync_outbox_v2
                     SET status = 'REJECTED', next_retry_at = NULL,
                         lease_owner = NULL, lease_expires_at = NULL,
                         updated_at = ?, last_error = 'SALE_POSTED_PAYLOAD_JSON_INVALID'
                     WHERE local_sequence = ? AND event_id = ?
                       AND status IN ('PENDING','RETRY_WAIT')`,
                    [timestamp, Number(row.local_sequence), eventId]
                );
                changed++;
                continue;
            }
            const missingSaleContract = isTransaction && (
                eventType === 'TRANSACTION_CREATED'
                || (eventType === 'SALE_POSTED' && (
                    !payload.summary
                    || !payload.occurred_at
                    || !payload.transaction
                ))
            );
            const needsUuidRepair = !isUuid(eventId);

            if (!needsUuidRepair && !missingSaleContract && !(isTransaction && eventType === 'SALE_POSTED')) {
                continue;
            }

            let nextPayload = payload;
            if (isTransaction) {
                try {
                    if (missingSaleContract) {
                        const transaction = payload.transaction
                            || JSON.parse(String(row.transaction_json || '{}'));
                        const {
                            transaction: _transaction,
                            summary: _summary,
                            occurred_at: _occurredAt,
                            occurredAt: _legacyOccurredAt,
                            ...additionalPayload
                        } = payload;
                        nextPayload = buildSalePostedPayload(transaction, additionalPayload);
                    } else {
                        // A canonical persisted event is immutable during retry. Validate it,
                        // but never rebuild or mutate its payload.
                        assertSalePostedPayload(payload);
                        if (!needsUuidRepair) continue;
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    await sql(
                        `UPDATE sync_outbox_v2
                         SET status = 'REJECTED', next_retry_at = NULL,
                             lease_owner = NULL, lease_expires_at = NULL,
                             updated_at = ?, last_error = ?
                         WHERE local_sequence = ? AND event_id = ?
                           AND status IN ('PENDING','RETRY_WAIT')`,
                        [timestamp, message.slice(0, 1_000), Number(row.local_sequence), eventId]
                    );
                    changed++;
                    continue;
                }
            }

            await sql(
                `UPDATE sync_outbox_v2
                 SET event_id = ?,
                     event_type = CASE
                         WHEN UPPER(aggregate_type) = 'TRANSACTION' THEN 'SALE_POSTED'
                         ELSE event_type
                     END,
                     payload_json = ?,
                     next_retry_at = ?, updated_at = ?,
                     last_error = 'EVENT_CONTRACT_MIGRATED'
                 WHERE local_sequence = ? AND event_id = ?
                   AND status IN ('PENDING','RETRY_WAIT')`,
                [
                    needsUuidRepair ? uuidv4() : eventId,
                    JSON.stringify(nextPayload),
                    timestamp,
                    timestamp,
                    Number(row.local_sequence),
                    eventId,
                ]
            );
            changed++;
        }

        if (changed > 0) await this.refreshMetrics();
        return changed;
    }

    async leaseDue(options: {
        owner: string;
        limit: number;
        leaseMs: number;
        now?: Date;
    }): Promise<DurableOutboxRecord[]> {
        const sql = this.requireSql();
        const now = options.now || new Date();
        const nowIso = now.toISOString();
        const expiresAt = new Date(now.getTime() + Math.max(1_000, options.leaseMs)).toISOString();
        const limit = Math.max(1, Math.min(100, Math.floor(options.limit)));
        await sql(
            `UPDATE sync_outbox_v2
             SET status = 'SENDING',
                 attempt_count = attempt_count + 1,
                 lease_owner = ?,
                 lease_expires_at = ?,
                 updated_at = ?
             WHERE local_sequence IN (
                 SELECT local_sequence
                 FROM sync_outbox_v2
                 WHERE status IN ('PENDING','RETRY_WAIT')
                   AND (next_retry_at IS NULL OR next_retry_at <= ?)
                 ORDER BY local_sequence ASC
                 LIMIT ?
             )`,
            [options.owner, expiresAt, nowIso, nowIso, limit]
        );
        const result = await sql(
            `SELECT * FROM sync_outbox_v2
             WHERE status = 'SENDING' AND lease_owner = ? AND lease_expires_at = ?
             ORDER BY local_sequence ASC`,
            [options.owner, expiresAt]
        );
        const records = rowsFromResult(result).map(mapRecord).sort((left, right) => left.localSequence - right.localSequence);
        await this.refreshMetrics();
        return records;
    }

    async markRetry(eventId: string, error: string, nextRetryAt: Date): Promise<void> {
        const now = new Date().toISOString();
        await this.requireSql()(
            `UPDATE sync_outbox_v2
             SET status = 'RETRY_WAIT', next_retry_at = ?, lease_owner = NULL,
                 lease_expires_at = NULL, updated_at = ?, last_error = ?
             WHERE event_id = ? AND status = 'SENDING'`,
            [nextRetryAt.toISOString(), now, error.slice(0, 1_000), eventId]
        );
        syncMetrics.increment('retry_count');
        await this.refreshMetrics();
    }

    async releaseUnsent(eventIds: string[]): Promise<void> {
        if (eventIds.length === 0) return;
        const now = new Date().toISOString();
        const placeholders = eventIds.map(() => '?').join(',');
        await this.requireSql()(
            `UPDATE sync_outbox_v2
             SET status = 'PENDING', attempt_count = MAX(0, attempt_count - 1),
                 lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
             WHERE event_id IN (${placeholders}) AND status = 'SENDING'`,
            [now, ...eventIds]
        );
        await this.refreshMetrics();
    }

    async markRejected(eventId: string, error: string): Promise<void> {
        const now = new Date().toISOString();
        await this.requireSql()(
            `UPDATE sync_outbox_v2
             SET status = 'REJECTED', lease_owner = NULL, lease_expires_at = NULL,
                 next_retry_at = NULL, updated_at = ?, last_error = ?
             WHERE event_id = ? AND status IN ('SENDING','RETRY_WAIT','PENDING')`,
            [now, error.slice(0, 1_000), eventId]
        );
        await this.refreshMetrics();
    }

    async markSyncedMaster(eventId: string, at = new Date()): Promise<void> {
        const timestamp = at.toISOString();
        await this.requireSql()(
            `UPDATE sync_outbox_v2
             SET status = 'SYNCED_MASTER', master_synced_at = ?, lease_owner = NULL,
                 lease_expires_at = NULL, next_retry_at = NULL, updated_at = ?, last_error = NULL
             WHERE event_id = ? AND status IN ('SENDING','SYNCED_MASTER')`,
            [timestamp, timestamp, eventId]
        );
        await this.refreshMetrics();
    }

    async markAppliedErp(eventId: string, at = new Date()): Promise<void> {
        const timestamp = at.toISOString();
        await this.requireSql()(
            `UPDATE sync_outbox_v2
             SET status = 'APPLIED_ERP', erp_applied_at = ?, lease_owner = NULL,
                 lease_expires_at = NULL, next_retry_at = NULL, updated_at = ?, last_error = NULL
             WHERE event_id = ? AND status IN ('SENDING','SYNCED_MASTER','APPLIED_ERP')`,
            [timestamp, timestamp, eventId]
        );
        syncMetrics.markErpApplied(timestamp);
        await this.refreshMetrics();
    }

    async refreshMetrics(): Promise<void> {
        if (!this.database.executeSQL) return;
        const result = await this.database.executeSQL(
            `SELECT COUNT(*) AS pending_count, MIN(created_at) AS oldest_created_at
             FROM sync_outbox_v2
             WHERE status IN ('PENDING','SENDING','RETRY_WAIT')`
        );
        const row = rowsFromResult(result)[0];
        const oldest = row?.oldest_created_at ? Date.parse(String(row.oldest_created_at)) : null;
        syncMetrics.setOutboxState(Number(row?.pending_count || 0), Number.isFinite(oldest) ? oldest : null);
    }

    private requireSql(): (query: string, params?: any[]) => Promise<any> {
        if (!this.database.executeSQL) {
            throw new Error('El adaptador activo no permite consultas SQLite para Outbox V2.');
        }
        return this.database.executeSQL.bind(this.database);
    }
}

export const durableOutboxRepository = new DurableOutboxRepository();
