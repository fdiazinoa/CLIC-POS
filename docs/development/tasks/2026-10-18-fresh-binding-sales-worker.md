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
