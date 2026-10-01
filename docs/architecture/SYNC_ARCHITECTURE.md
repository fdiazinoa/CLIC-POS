# Sync architecture

## LAN POS ↔ master

`SyncManager` orchestrates catalog/config sync through `ApiSyncAdapter`. The adapter uses HTTP timeout, bounded retry for selected network/503/504 failures and a circuit breaker. `RealtimeNotificationService` consumes Socket.IO hints; periodic pulls remain active. The master persists terminal tokens, versions and `sync_changes` in `server/schema.sql` and serves them from `server/routes/sync.ts`.

Operational records (transactions, inventory movements, cash movements and Z reports) use document `syncStatus` values. `BackgroundSyncManager` processes pending/error records serially and recovers stale `SYNCING` states after restart.

## POS → ERP

`BackgroundSyncManager` first pushes a sale to the LAN master, then `postSalePostedToErp` posts a deterministic event id to `/api/sync/inbox`. The deterministic id supports ERP-side idempotency, but the baseline has no separate durable ERP outbox in the POS. If ERP posting fails after LAN completion, the error is logged and the transaction can still become `COMPLETED`, leaving no selected retry record.

Required gate: disconnect ERP after master acknowledgement, restart POS, reconnect and prove eventual ERP `APPLIED` exactly once.

## ERP → POS

`erpSyncLifecycle` polls `/outbox/pull` in batches of 20, applies supported bootstrap/config events sequentially and acknowledges each event. It also performs register and heartbeat calls. App lifecycle triggers polling/heartbeat on interval, online and focus.

The baseline uses an in-memory promise as overlap protection, not a durable lease/cursor. A crash after apply and before ack can redeliver. There is no observed Supabase Realtime subscription for ERP outbox delivery.

## Known validation targets

- multiple catalog collections in one sync pass (a shared throttle timestamp may suppress later pulls);
- lost realtime hint followed by polling recovery;
- crash at receive/apply/ack/recalculate boundaries;
- duplicate deterministic sale event;
- ERP outage after LAN success;
- batch larger than 20 and poison event handling;
- bounded backoff/dead-letter behavior;
- token mismatch/expiry and socket authentication;
- repeated service initialization without listener/timer leaks.

`services/sync/SyncQueue.ts` is not the canonical queue: no active enqueue/worker consumer was found, web storage lacks its SQL primitive, and `ERROR` rows are not selected for retry.

