# Source invariant implementation substep

Role/session: developer `/root/v3_financial_developer`; orchestrator `/root`. Base `dc92365733b774203d282db23e6306ac05accb2f`; branch `feature/sync-v3-operational-pos`; worktree `/Users/felixdiaz/.codex/worktrees/v3-canary-routing/CLIC-POS`. Source remains uncommitted. Status **IMPLEMENTATION COMPLETED (source invariants substep only)**. Independent review and all applicable acceptance gates remain pending; this report grants no approval.

This continuation closes three approved-plan invariants identified by independent preliminary inspection. UI ownership was transferred to `/root/v3_ui_integration_developer`; this continuation does not own App, POSInterface, OperationalPOS, utils/db, OperationalCatalog tests or checkoutLatency tests anymore.

## Changes

1. Direct native baseline mutations now inspect the held cart/payment/print window, including before the first local ledger exists. `LargeMasterSyncV3OperationGate.ts` exports its held-window predicate. `LargeMasterSyncV3SqliteStore.ts` checks it for direct activate (including an already-active request), rollback, inventory replacement and operational-owner change, and rechecks immediately before pointer/destructive writes after asynchronous reads. Existing persisted-movement prohibition remains. Staging metadata preparation retains the existing behavior: it does not replace the active baseline, remains forbidden after a local ledger movement, and the client separately waits before applying chunks. Tests cover cart and payment holds for every direct path, and a hold acquired during the activation state read.

2. `LargeMasterSyncV3LineSource.ts` compares pinned source type, inventoriable flag, taxable flag, tax IDs, tariff tax-inclusion treatment and exact active variant ID/SKU against each cart line. `LargeMasterSyncV3OperationalSession.validate` invokes that comparison before availability and financial callbacks. The financial builder obtains canonical source-confirmed line copies via that validation callback and builds ledger/persisted lines from those copies. `validateV3FrozenLineFiscalAmounts` recomputes line/header net/tax/total from projected V3 taxes, final permitted line price, discount, customer exemption/service policy and bounded configured legal charge, rather than accepting a merely self-consistent aggregate. Price edits and discounts remain supported. `transactionService.createTransaction` performs this source fiscal check before sequence allocation; the final atomic financial builder repeats it before ledger creation/persistence.

3. `LargeMasterSyncV3FinancialRetention.ts` defines the restricted ACK/fiscal/status/Z update fields. Native document upserts merge those mutable fields into the existing V3 transaction/history source; they retain baseline/binding/warehouse/fingerprint, line stamps, items, amounts and original business identity even when an incoming full or incremental replacement omits private fields. Related-transaction links are unioned rather than lost. Schema initialization installs an additional transaction/history authority trigger that rejects raw SQL replacements stripping core authority/items/amounts. Existing delete retention and immutable inventory movement triggers remain. Legacy documents keep existing replacement/delete semantics. Fingerprint comparison excludes legitimate mutable ACK/fiscal/Z/link changes so replay after acknowledgment/closing remains idempotent.

Files changed in this service-only continuation:

- `services/sync/LargeMasterSyncV3OperationGate.ts`
- `services/db/LargeMasterSyncV3SqliteStore.ts`
- `services/sync/LargeMasterSyncV3LineSource.ts` (new)
- `services/sync/LargeMasterSyncV3OperationalSession.ts`
- `services/sync/LargeMasterSyncV3FinancialCommit.ts`
- `services/db/LargeMasterSyncV3FinancialRetention.ts` (new)
- `services/db/adapters/CapacitorSQLiteAdapter.ts`
- `services/transactionService.ts`
- `tests/largeMasterSyncV3SourceInvariants.test.ts` (new)
- `tests/largeMasterSyncV3FinancialAtomic.test.ts`

No BackgroundSyncManager/SyncManager edits were needed: their native document writes use the protected adapter boundary.

## Checks

After centralized dependency installation under Node22, final command:

`npx --yes --package=node@22 -c 'node node_modules/tsx/dist/cli.mjs --test tests/largeMasterSyncV3SourceInvariants.test.ts tests/largeMasterSyncV3FinancialAtomic.test.ts tests/largeMasterSyncV3RefundAuthority.test.ts tests/largeMasterSyncV3Receiver.test.ts tests/largeMasterSyncV3Migration.test.ts tests/durableOutboxV2.test.ts tests/recoveryAtomicAdapters.test.ts'`

Result: **67/67 tests passed, exit 0**. Native retention tests invoke the production private `initSchema` on actual host SQLite, verify the installed triggers, exercise `bulkUpsert`, `saveCollection`, direct raw replacement, ACK/fiscal/Z amendments, pruning, and legacy update/delete behavior. Financial replay is also tested after an incoming ACK/Z/fiscal replacement that attempts to replace items/total. The new helper tampering tests prove type/inventory/tax/variant mismatches fail before a simulated next side effect; they do not certify actual Android payment-provider behavior.

`npx --yes --package=node@22 -c 'node node_modules/typescript/bin/tsc -b --pretty false'` — final exit 0.

`git diff --check` — exit 0.

An intermediate 67-test run had 65 pass / 2 fail because applying the held-window guard to staging metadata broke existing prefetch waiter semantics. Implementation was corrected narrowly: staging still enforces persisted-ledger freeze, while direct active-baseline mutation guards remain strict. The same unchanged receiver/prefetch tests then passed in the final 67/67 run. No tests were removed or weakened.

## Freeze and remaining work

All service/native/test files owned by this continuation are frozen and released to the orchestrator. UI author continues its independently assigned queue/lifecycle/hydration/publication work. No device identity/configuration changes, remote writes, commits, pushes, Gradle/APK builds, installation or own gate approval were performed. Full review, frozen-source QA, sync/performance/device/ERP and release requirements remain pending.
