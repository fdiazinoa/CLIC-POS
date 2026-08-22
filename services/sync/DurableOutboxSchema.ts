export const DURABLE_OUTBOX_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS sync_outbox_v2 (
        local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (status IN ('PENDING','SENDING','RETRY_WAIT','SYNCED_MASTER','APPLIED_ERP','REJECTED')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        master_synced_at TEXT,
        erp_applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_v2_due
        ON sync_outbox_v2(status, next_retry_at, local_sequence);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_v2_aggregate
        ON sync_outbox_v2(aggregate_type, aggregate_id, local_sequence);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_v2_lease
        ON sync_outbox_v2(status, lease_expires_at);

    CREATE TABLE IF NOT EXISTS payment_intents_v2 (
        intent_id TEXT PRIMARY KEY NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payment_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        integration_id TEXT,
        transaction_id TEXT,
        amount REAL NOT NULL,
        currency_code TEXT NOT NULL,
        status TEXT NOT NULL
            CHECK (status IN ('CREATED','AUTHORIZING','AUTHORIZED','DECLINED','UNKNOWN','COMMITTED','RECONCILIATION_REQUIRED')),
        provider_reference TEXT,
        authorization_code TEXT,
        response_code TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        authorized_at TEXT,
        committed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payment_intents_v2_status
        ON payment_intents_v2(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_payment_intents_v2_transaction
        ON payment_intents_v2(transaction_id);
`;
