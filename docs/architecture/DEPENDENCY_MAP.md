# Dependency map

## Application dependencies

| Concern | Canonical modules | Downstream effects |
|---|---|---|
| App state/routing | `App.tsx` | almost every operational screen and service lifecycle |
| POS/cart | `components/POSInterface.tsx` | pricing, promotion, payment, tickets, tables |
| Payment | `components/PaymentModal.tsx` | transaction creation, print, Z totals |
| Fiscal/pricing | `utils/pricing.ts`, `utils/fiscalBreakdown.ts`, `utils/promotionEngine.ts` | line totals, tax, discounts, Z/reporting |
| Transaction persistence | `services/transactionService.ts`, `utils/db.ts` | sequence, inventory, receivables, sync |
| Storage selection | `services/db/index.ts` | Android SQLite vs web IndexedDB behavior |
| LAN sync | `SyncManager`, `ApiSyncAdapter`, `BackgroundSyncManager`, `server/routes/sync.ts` | catalog and operational consistency |
| ERP sync | `utils/erpSyncLifecycle.ts` | POS→ERP sale events, ERP→POS config/bootstrap |
| Printing | `utils/printer.ts`, `services/printer/*`, `native-stubs/*` | ticket/Z/label delivery and hardware |
| Auth/tenant | `utils/supabase.ts`, `utils/licenseGuard.ts`, `utils/cloudMasterRegistry.ts` | login, license, tenant scope, master discovery |
| Android package | `capacitor.config.ts`, `android/app/build.gradle`, manifest, native stubs | WebView runtime, version, signing, network, bridge |

## Package/runtime facts

- npm lockfile is present; use `npm ci` for reproducible gates.
- React/runtime packages are version 19 while React type packages are version 18 at the baseline; treat type/runtime changes as a compatibility risk.
- `better-sqlite3` powers the LAN server; `@capacitor-community/sqlite` powers Android; IndexedDB powers web.
- `socket.io` provides LAN hints; HTTP polling remains the fallback.
- Supabase is an identity/cloud-discovery boundary, not the canonical transaction store.

## Change propagation rules

- A total/pricing/promotion change reaches checkout, persisted transactions, printed tickets, Z close, reporting and ERP payloads.
- A database adapter change reaches offline durability, startup migration, sync queues and restart recovery.
- A sync protocol change reaches client adapter, master route/schema, realtime hints, retry/idempotency and telemetry.
- A table change reaches parked tickets, checkout, kitchen flow and Z close.
- An Android bridge/config change requires web build, Capacitor sync, device tests and often signature/version checks.

The executable impact matrix is `dev-harness/config/clic-pos.json`.

