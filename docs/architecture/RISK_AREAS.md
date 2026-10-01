# Audited risk areas

This register records baseline risks; installation of the harness does not fix them.

| Risk | Evidence | Required gate focus |
|---|---|---|
| Sale effects are non-atomic and completion is not awaited by one caller | `POSInterface.tsx`, `App.handleTransactionComplete`, `transactionService.ts` | fault injection between transaction/ledger/stock/debt/sync |
| Discount/price paths can bypass safe bounds/authorization | `GlobalDiscountModal.tsx`, `CartItemOptionsModal.tsx`, `POSInterface.tsx` | 0/100/>100, negative total, supervisor policy |
| Overpayment/multi-currency may distort Z totals | `PaymentModal.tsx`, `ZReportDashboard.tsx` | tender/change and unit consistency |
| Mixed transaction fiscal calculation diverges from configurable taxes | `POSInterface.tsx` mixed-sale branch | multi-rate inclusive/exclusive fiscal matrix |
| Table reopen sources disagree; split/merge/pre-check placeholders exist | `parkedTickets`, `App.tsx`, `TableMap.tsx` | full table lifecycle, no placeholder pass |
| Coupon is persisted redeemed before sale completion | `couponService.ts`, `POSInterface.tsx` | cancel/failure rollback |
| Z close/print/email/persistence are separate steps | `ZReportDashboard.tsx`, `App.tsx` | idempotent crash recovery |
| Android collection writes are whole-array read-modify-rewrite | `CapacitorSQLiteAdapter.ts` | concurrent writer/lost-update test |
| POS→ERP has no durable ERP outbox | `BackgroundSyncManager.ts`, `erpSyncLifecycle.ts` | ERP outage after LAN completion |
| ERP client lacks observed auth/timeout/backoff/lease | `erpSyncLifecycle.ts` | security, timeout, crash/redelivery |
| LAN catalog pull uses shared throttle/watchdog state | `SyncManager.ts` | multi-collection and overlapping pull |
| Offline queues lack bounded backoff/dead-letter | offline hooks and print queue | poison item/retry exhaustion |
| Reinitialization can accumulate listeners | `BackgroundSyncManager`, `ApiSyncAdapter`, `App.tsx` | lifecycle leak test |
| Android release can continue without signing config | `android/app/build.gradle` conditional signing | fail-closed signing/signature gate |
| Version sources disagree | Git tags, `package.json`, Android Gradle | monotonic/canonical version gate |
| HTTP LAN policy is not explicit in Android manifest | network doc, manifest, Capacitor config | real device LAN connectivity/security |
| Native print shim contract is not visibly injected | `MainActivity.java`, native stub docs/code | physical printer bridge/device test |
| Cloud-Admin upload/publish contract is absent | only `posApkUpdateService` GET consumer exists | deployment remains blocked |
| Tracked private-key/data-like artifacts exist | tracked filenames include PEM and operational dumps | rotate/purge in separate approved task; secret/PII scan |
| Product test/CI/performance infrastructure is absent on main | `package.json`, no CI/test config | never substitute harness tests for product QA |

No secret content is reproduced here. Rotation and Git history cleanup are destructive/security operations outside this harness-install task.

