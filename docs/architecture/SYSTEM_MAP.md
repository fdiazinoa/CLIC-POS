# CLIC-POS system map

Audit baseline: `origin/main` at `319e10d` on 2026-10-01. Statements below name the code/config evidence used; this document does not claim unobserved production behavior.

## Runtime topology

```text
React/Vite UI (App.tsx + feature components)
  ├─ web runtime → IndexedDBAdapter
  ├─ Android/Capacitor → CapacitorSQLiteAdapter → clic_pos_native
  ├─ LAN client → ApiSyncAdapter / Socket.IO → local master :3001
  ├─ local master → Express + better-sqlite3 (server/)
  ├─ ERP lifecycle → HTTP inbox/outbox endpoints
  ├─ Supabase → auth, license/tenant identity, master discovery
  └─ print routing → native bridge/local agent/browser fallback
```

`services/db/index.ts` selects SQLite only for native Android and IndexedDB otherwise. `LocalStorageAdapter`, `SQLiteWASMAdapter` and `NetworkAdapter` exist but are not selected by the canonical factory.

## Frontend composition and state

- `App.tsx` is the bootstrap, view router, application-level store and side-effect orchestrator. It owns users/config/products/transactions/Z reports/rooms/tables/cart and starts storage, sync and printer services.
- `components/POSInterface.tsx` owns catalog interaction, cart, promotions, totals, table tickets and checkout orchestration.
- State is primarily React `useState`/`useEffect`; there is no Redux/Zustand/domain reducer. Context is limited to theme and kiosk security (`ThemeContext.tsx`, `components/kiosk/KioskContext.tsx`).
- Large operational screens are statically imported by `App.tsx`; Vite defines manual chunks in `vite.config.ts`, but there is no `React.lazy` boundary at this baseline.

## Storage and server

- Android `CapacitorSQLiteAdapter` stores whole collections as JSON in `collections`; `sync_queue` is the exception with relational rows. Document updates are read-modify-rewrite operations.
- Web `IndexedDBAdapter` creates collection object stores, migrates legacy `clic_pos_db_v1` from localStorage and can fall back to localStorage when IndexedDB is blocked.
- `utils/db.ts` is the broad compatibility façade used by UI/services.
- `server/index.ts`, `server/db.ts`, `server/routes/*` form the LAN master API over Express/SQLite. `server/routes/sync.ts` provides authentication, catalog deltas, transaction and operational queues.

## External boundaries

- Supabase: `utils/supabase.ts`, `utils/licenseGuard.ts`, `utils/cloudMasterRegistry.ts`.
- ERP sync: `utils/erpSyncLifecycle.ts`.
- Local realtime hints: `services/sync/RealtimeNotificationService.ts` and `server/socket.ts`.
- Printing: `utils/printer.ts`, `services/printer/*`, Android stubs under `native-stubs/android`.
- APK update consumption: `services/version/posApkUpdateService.ts` calls `GET /api/pos-apk/latest`; this repository contains no matching upload/publish implementation.

## Toolchain

- npm (`package-lock.json` v3), Vite 5, TypeScript 5, React 19, Capacitor 8.
- Android config is `android/app/build.gradle`; baseline version is `versionCode 41`, `versionName 1.0.40`, JDK target 21.
- At the audit baseline there was no web test runner, CI/CD definition or performance collector. `npm run lint` existed without a visible ESLint 9 configuration. Harness tests are therefore separate from POS product tests.

