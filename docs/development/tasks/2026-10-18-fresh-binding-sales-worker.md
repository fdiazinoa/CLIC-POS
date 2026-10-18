# Sales sender after fresh terminal binding

After clearing DEMO storage and pairing again, the paired-terminal startup branch
does not run. Pairing initialized SyncManager but omitted BackgroundSyncManager.
The native durable outbox therefore held SALE/PAYMENT at PENDING, attempt_count=0,
while ERP master downloads worked. Runtime observed online=true and pushes_total=0.

Start the existing BackgroundSyncManager after successful binding, persisted
identity/configuration and device reauthorization, before showing LOGIN. Its existing
remote authority and network adapter guards remain in force. No immediate replay,
new financial event, fiscal ISSUE, flag change or counter change is introduced.

## Operational hold

The DEMO reset reused TCK6000036 and E320000000516 for a different transaction:
the original sale total is 678.40; the new sale total is 108.80. The original is
in the ERP inbox; the new sale was observed only in the native queue. These are
distinct source identities. Do not admit the original recovery or force the new
queue while this fiscal identity collision remains unresolved. Do not edit either
invoice's amounts, NCF or payload to make it pass. Existing recovery descriptors
for the original are invalidated by this new evidence.

## Validation

- Web TypeScript/Vite build passed.
- Existing background recovery, terminal binding hierarchy, authorization and
  upgrade persistence tests: 20 passed.
- Physical fresh binding and queue acknowledgement remain pending; no reinstall,
  restart, DB edit, invoice application or fiscal emission was performed.

## Subsequent explicit DEMO cleanup

The user explicitly requested deleting the new local queue and the old Supabase
inbox before pairing again. The new SALE/PAYMENT pair was removed from native
storage with the application stopped: queue=0, integrity=ok, all other 48 tables
unchanged. The user declined retaining a backup; the just-created copy was removed.

The old FAILED SALE/PAYMENT pair was deleted atomically after exact identity,
payload checksum and zero-effects checks. Two DELETE audit entries record request
`demo-cleanup-tck36-20261018`. Postcheck: inbox36=0, fiscal documents with this NCF=0.
No counters, fiscal configuration, stock, payments or documents were changed.
The earlier recovery HOLD descriptors are obsolete and must never be executed.
The sender fix still requires an updated APK; cleanup alone does not install it.
