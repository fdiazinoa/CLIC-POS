# Financial implementation substep

Role/session: developer `/root/v3_financial_developer`; orchestrator `/root`. Base: `dc92365733b774203d282db23e6306ac05accb2f`. Worktree: `/Users/felixdiaz/.codex/worktrees/v3-canary-routing/CLIC-POS`; branch `feature/sync-v3-operational-pos`. Source remains uncommitted. Status: **IMPLEMENTATION COMPLETED (financial substep only)**. No gate approval, code review approval, QA approval or release approval is implied.

Approved plan: `analysis.md`, `plan-review.md`, `plan-amendment-validation-phase.md`. Existing financial/refund-authority edits were preserved; this substep did not modify artifact/build/catalog files.

## Changes

- `services/sync/LargeMasterSyncV3FinancialCommit.ts`: prepares mixed V3 refund/sale in one native commit, merges customer/wallet updates while retaining the first stored CAS snapshot, preserves sale/payment outbox events when already enabled, keeps deterministic ledger IDs and replay fingerprints, and rejects missing or mixed frozen fiscal sources.
- `services/sync/LargeMasterSyncV3OperationalSession.ts`: derives aggregate positive sale demand from pinned source policy; refund, SERVICE/noninventoriable and explicit negative-stock permissions impose no controlled sale demand.
- `services/db/DatabaseAdapter.ts`: adds verified V3 stock-requirement metadata to document mutations.
- `services/db/adapters/CapacitorSQLiteAdapter.ts`: checks baseline ownership, CAS and aggregate availability after BEGIN under the shared native write queue. Availability includes the exact baseline and all matching local ledger deltas regardless of ACK. Existing legacy executeSet behavior is retained for mutations without V3/CAS preconditions.
- `services/transactionService.ts`: validates V3 source before allocating transaction sequence and commits both mixed companions atomically.
- `components/POSInterface.tsx`: supplies frozen V3 split refund/sale amounts and native batch context; skips duplicate standalone refund persistence after the batch.
- `App.tsx`: allows publication of the already committed split sale through its normal completion callback.
- `tests/largeMasterSyncV3FinancialAtomic.test.ts`: actual host SQLite concurrency, aggregate demand, foreign-scope/ACK isolation, injected failure rollback, customer CAS, real financial batch merge/replay, outbox and fiscal/service movement regressions. Browser identity/session boundaries are mocked in batch tests; Android runtime is not certified.

`services/localRefundPersistence.ts` and the separately repaired `LargeMasterSyncV3RefundAuthority.ts` expected-original/history snapshots were preserved unchanged by this substep.

## Evidence

Executed with Node22:

`npx --yes --package=node@22 -c 'node node_modules/typescript/bin/tsc -b --pretty false'` — final exit 0.

`npx --yes --package=node@22 -c 'node node_modules/tsx/dist/cli.mjs --test tests/largeMasterSyncV3FinancialAtomic.test.ts tests/largeMasterSyncV3RefundAuthority.test.ts tests/largeMasterSyncV3CheckoutAuthority.test.ts tests/refundAvailability.test.ts tests/recoveryAtomicAdapters.test.ts'` — final 19/19 tests passed, exit 0.

`git diff --check` — exit 0.

Earlier broad command: `npx --yes --package=node@22 -c 'node node_modules/tsx/dist/cli.mjs --test tests/largeMasterSyncV3*.test.ts tests/refundAvailability.test.ts tests/recoveryAtomicAdapters.test.ts tests/durableOutboxV2.test.ts tests/localRefundPersistenceRemote.test.ts'` — 107 tests, 59 passed, 48 failed, exit 1. Failures included better-sqlite3 installed ABI137 versus Node22 ABI127; four OperationalCatalog mocks missing `getOperationalSupports`; and one legacy executeSet bridge regression. The executeSet regression was repaired and the focused recovery suite passed afterward. The broad suite was not rerun after that repair. Dependency ABI repair is centralized by the orchestrator; no tests/baselines were weakened.

## Handoff and limits

Financial/service files are frozen for the next UI substep. Immediate mixed-refund list refresh requires UI/runtime inspection; the financial batch is durable before callbacks run. Full independent review, QA, sync, performance, Android/ERP evidence and required broad suites remain pending. No source commit, push, Gradle, APK build, installation, Cloud-Admin action or gate approval was performed.
