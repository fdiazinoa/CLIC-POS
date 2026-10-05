# Native mutation fence and retry-metadata continuation

Status: **IMPLEMENTATION COMPLETED (developer substep only)**. Role `/root/v3_financial_developer`; orchestrator `/root`; branch `feature/sync-v3-operational-pos`; worktree `/Users/felixdiaz/.codex/worktrees/v3-canary-routing/CLIC-POS`. Independent review and frozen-source QA remain required. This report approves no gates.

## Narrow changes

- `services/sync/LargeMasterSyncV3OperationGate.ts`: synchronous exclusive baseline-mutation reservation. Acquisition rejects held cart/payment/print or another reservation. Critical-operation acquisition rejects a live reservation before incrementing its count or invoking its task/provider. Operational-window waiters also wait for the reservation; release wakes them. The store holds the reservation across every native await, including BEGIN, writes, COMMIT and rollback, and releases in finally.
- `services/db/LargeMasterSyncV3SqliteStore.ts`: activate, rollback, inventory replacement and operational-owner updates acquire that reservation inside the existing shared write lock. Each rechecks the held cart/critical window immediately before COMMIT, so a cart acquired during writes causes rollback. Owner UPSERT now uses an explicit BEGIN IMMEDIATE/COMMIT/ROLLBACK transaction and passes transaction=false to the run call. Staging metadata preparation behavior and existing persisted-ledger freeze are preserved.
- `services/db/LargeMasterSyncV3FinancialRetention.ts`: retain the real sync protocol's `syncStartedAt`, `syncRetryAfter`, `syncBlockedReason`, `syncBlockedAt` and `_forceSyncReplay` as mutable fields without permitting financial source replacement. A complete source-identical save with the same non-null V3 fingerprint may clear absent transient fields, matching BackgroundSyncManager's delete/undefined JSON serialization. Partial incoming ACK/replacement, missing fingerprint, incomplete source, or altered immutable source cannot clear the stored retry metadata. The complete-source comparison checks every stored non-mutable field's JSON key/type/value; related links remain unioned.
- `tests/largeMasterSyncV3MutationFence.test.ts`: 13 real host-SQLite regressions, with deterministic promise barriers rather than sleeps. Every mutation route is suspended inside awaited write and awaited COMMIT; PAYMENT is rejected before its provider, a concurrent mutation is rejected, and window waiters remain blocked until release. Every route rolls back when a cart appears during writes and recovers afterward. Injected owner COMMIT failure retains exclusion through awaited ROLLBACK, restores owner, and permits the next transaction/payment.
- `tests/largeMasterSyncV3SourceInvariants.test.ts`: extends the production-initSchema retention test with all five actual sync fields, partial remote ACK, matching-fingerprint-but-incomplete replacement, changed-source replacement, real delete/undefined serialization, explicit null removal and false replay flag. Financial items/totals/fingerprint remain retained.

No UI, configuration/identity, BackgroundSyncManager, artifact/build/release or unrelated committed files were edited in this continuation. Shared worktree UI edits belong to its separate author.

## Evidence

Final focused command, Node22:

`npx --yes --package=node@22 -c 'node node_modules/tsx/dist/cli.mjs --test tests/largeMasterSyncV3MutationFence.test.ts tests/largeMasterSyncV3SourceInvariants.test.ts tests/largeMasterSyncV3FinancialAtomic.test.ts tests/largeMasterSyncV3RefundAuthority.test.ts tests/largeMasterSyncV3Receiver.test.ts tests/largeMasterSyncV3Migration.test.ts tests/durableOutboxV2.test.ts tests/recoveryAtomicAdapters.test.ts'`

Result: **80/80 pass, exit 0; no skipped/cancelled tests**. Earlier fence-only combined suite passed 51/51; broader suite before the final absent-field refinement also passed 80/80. No implementation test failures occurred during this continuation. Node reports its expected experimental SQLite warning; negative-contract tests emit their expected rejection diagnostic.

`npx --yes --package=node@22 -c 'node node_modules/typescript/bin/tsc -b --pretty false'` — exit 0.

`git diff --check` — exit 0.

One exploratory rg included two nonexistent alternate service paths and exited 2; the actual `services/sync/BackgroundSyncManager.ts` was read successfully and its real delete/undefined/replay protocol informed the retention regression. This was not a test failure.

## Freeze

All five source/test files above and this report are frozen and released to the orchestrator. No further tests or edits will be performed without a new assignment. No commits, pushes, APK builds/installations, remote writes or device mutations were performed. Evidence is host source/test evidence, not Android payment-provider certification or independent review/QA approval.
