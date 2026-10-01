# Offline architecture

## Persistence by runtime

- Native Android: `CapacitorSQLiteAdapter` opens `clic_pos_native` without encryption and stores each logical collection as one JSON value. `saveDocument` reads and rewrites the full collection.
- Web: `IndexedDBAdapter` uses one object store per collection and can fall back to localStorage if IndexedDB is blocked or a write fails.
- Sync cursors, endpoint configuration and device/session identifiers also use localStorage in several services.

Android writes to one collection are not compare-and-swap transactions; concurrent read-modify-rewrite calls can lose updates. Multi-collection operations such as sale→ledger→stock→receivable are not atomic.

## Offline queues

| Domain | Storage/model | Recovery behavior |
|---|---|---|
| Sales/ledger/cash/Z | business documents with `syncStatus` | serial background push; stale `SYNCING` becomes `ERROR` on restart |
| Receiving | `offline_reception_queue`, conflicts and reception collections | local apply then master upsert; retries error records |
| Inventory counts | dedicated collection queue in `useOfflineInventoryCountSync` | retries pending/error records |
| Print | `offline_print_queue` | FIFO processing and attempt count |
| ERP events | no durable POS ERP outbox found | LAN-completed sale can lack an ERP retry path |

The receiving and inventory flows update several collections without a database transaction. Attempts increase, but the observed queues do not impose bounded backoff/dead-letter policy. The harness defaults to two automatic retries and then `BLOCKED`; product queues need their own future remediation task.

## Required offline scenario

```text
connected baseline
→ disable LAN/internet as applicable
→ perform one operation
→ capture local document/queue ids
→ force app/process restart
→ prove operation is still present and pending
→ reconnect
→ prove remote apply/ack
→ prove local completion and no duplicate business effect
```

Run this separately for sale, payment policy, receipt/count, table order, ticket/Z print and any changed queue. Evidence must include stable ids and before/after persisted state, not only UI screenshots.

Changing `window.origin` can trigger deletion of a legacy IndexedDB in `App.tsx`; origin/host migration therefore requires a destructive-data safety gate.

