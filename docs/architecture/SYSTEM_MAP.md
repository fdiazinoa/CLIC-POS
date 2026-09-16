# Mapa del sistema

Auditoría estática: 2026-09-16. Fuente: `origin/develop` en `a186a8c33cabf8700c28dba85deaabfe76b03f81`. No certifica comportamiento en hardware ni estado desplegado del ERP. Las referencias son relativas a la raíz del repositorio.


## Arquitectura encontrada

CLIC-POS es una aplicación React con módulos operativos y administrativos en un mismo frontend TypeScript. No es un frontend ERP separado dentro de este repositorio. La integración ERP se realiza mediante API HTTP y notificaciones Supabase; el servidor ERP receptor no está completo aquí.

`index.html` carga `index.tsx`; este instala diagnóstico opcional y carga `bootstrap.tsx`. Bootstrap monta `App` y `ClicDialogHost` bajo `React.StrictMode`. `App.tsx` orquesta arranque, activación, terminal, usuario, navegación, catálogo, carrito, tickets, mesas, ventas, inventario, fiscal y cierre. Vite divide chunks por suites; no elimina la dependencia lógica entre estos módulos.

Stack declarado en `package.json`: React 19.2, Vite 5.4, TypeScript 5.5, Tailwind 3.4, Framer Motion 11, Capacitor 8, SQLite community 8, Supabase JS 2.98, Express 5, Socket.IO 4, better-sqlite3 12, sql.js 1.13, tsx 4 y zone.js 0.15.1 para diagnósticos. Son rangos declarados; `package-lock.json` fija la instalación. Los tipos React están en major 18: comprobar compatibilidad antes de actualizar.

## Estructura y responsabilidades

| Ruta | Responsabilidad observada |
|---|---|
| `App.tsx`, `types.ts`, `constants.ts` | Orquestación, contratos de dominio y defaults |
| `components/` | POSInterface, catálogo, cobro, mesas, tickets, settings, fiscal, finanzas, agenda/CRM, inventario, KDS, kiosk y price checker |
| `hooks/` | Barcode, supervisor, crédito, kiosk, tamaño móvil, offline recepción/conteo |
| `utils/` | DB facade, fiscal, impuestos, promociones, cantidades, impresión, identidad, políticas de operación y timing |
| `services/db/` | Contrato DatabaseAdapter y adaptadores de almacenamiento |
| `services/sync/` | Master/LAN/ERP, colas, catálogo, Realtime, polling, heartbeat, métricas y permisos |
| `services/payments/`, `services/fiscal/`, `services/printer/` | Integraciones de cobro, emisión fiscal y routing de impresión |
| `services/recovery/` | Captura, preparación, originales retenidos, restauración y recuperación de cierres |
| `services/auth/`, `services/setup/`, `services/routing/` | Nivel de auth, vinculación terminal y routing por rol |
| `server/` | Express, SQLite local, rutas API, forward Inbox ERP, correo/wallet y KDS Python |
| `android/`, `native-stubs/android/` | Shell Capacitor, WebView, Java/Kotlin, HTTP master/KDS, impresoras, visor y biometría |
| `native-stubs/electron/` | Stubs de impresión; no demuestra distribución Electron operativa |
| `supabase/migrations/` | Dos migraciones: CRM/booking e invoice review audit; no representa todo el esquema ERP |
| `tests/`, `scripts/qa/`, `qa/baselines/` | Node tests, fixtures/integraciones y golden APK gate |
| `diagnostics/`, `scripts/diagnostics/` | Instrumentación selectiva y captura/análisis temporal |
| `docs/`, `scripts/` | Protocolos y herramientas; scripts de reset/reconcile no son smoke tests seguros |

## Estado y eventos

`App` mantiene `useState` para config, usuario, productos, clientes, transactions, cart, parkedTickets, rooms/tables, cashMovements, Z/X, stocks y navegación. `POSInterface`, `PaymentModal` y `TableMap` agregan estado propio, refs, memos y efectos. Se observaron `ThemeContext` y `kiosk/KioskContext`; no se encontró un store Redux/Zustand central declarado. Singletons DB/sync/permission conviven con estado React y almacenamiento persistido.

Eventos DOM incluyen `productsUpdated`, `terminalConfigSyncRequested`, `terminalConfigRestartRequired`, `productionAreasUpdated`, `sync:reconnecting`, `pos:resume-recovered-close`, online, visibilitychange y revocación del dispositivo. Socket.IO cubre comunicación local. Cambios de estado, escrituras y eventos deben conservar orden y cleanup, especialmente con StrictMode y remounts.

## Persistencia real

`services/db/index.ts` elige CapacitorSQLiteAdapter solo en Android nativo; en web elige IndexedDBAdapter. Se envuelve mediante `recoveryDatabase` condicionado por `pending_operations_recovery`. `utils/db.ts` expone init/get/save/saveDocument, movimientos, secuencias, NCF, inventario y reset.

SQLite nativo crea `documents`, `storage_meta`, `sync_queue` y `master_number_ranges`; el esquema Outbox se encuentra en `DurableOutboxSchema.ts`. IndexedDBAdapter tiene migración y fallback localStorage, incluyendo colecciones pesadas: web no garantiza acceso íntegramente asíncrono. Preferences y localStorage guardan identidad, credenciales, overrides y config. `server/db.ts` abre `server/db.sqlite` con WAL y foreign_keys; es otro almacén, no la DB Android. NetworkAdapter, SQLiteWASMAdapter y LocalStorageAdapter existen pero no son la selección por defecto del factory actual.

## Operación y autenticación

Activación → elección de rol/mode → lista/vinculación terminal → config/usuarios/roles → login → routing operativo. Archivos: ActivationScreen, TerminalModeSelector, TerminalBindingScreen, LoginScreen, TerminalRouter, `services/setup/*`, TerminalCredentialStore, terminalIdentity, deviceToken, `utils/erpSyncLifecycle.ts`, `utils/supabase.ts` y AuthLevelService. El PIN/usuario operativo, token de terminal y sesión cloud son mecanismos distintos. Se debe probar MASTER con ERP, MASTER LOCAL_ONLY y SLAVE/cliente LOCAL_ONLY; order taker y handheld restringen acciones.

## Android y periféricos

`capacitor.config.ts`: appId `com.clicpos.app`, webDir `dist`, androidScheme https y SQLite sin cifrado Android declarado. `MainActivity.java` controla WebView, teclado/orientación, resume y crash guard. Instala AndroidPrinter, AndroidCustomerDisplay, ClicPOSAppBridge y diagnóstico condicionado. `android/app/build.gradle` incorpora `../../native-stubs/android` como fuentes: esos Kotlin se compilan, aunque la carpeta diga stubs. Incluyen master HTTP/discovery/KDS, Bluetooth printer y fingerprint DigitalPersona. PrintRouter/NativePrintBridge/BrowserPrint/LocalPrintAgent y `utils/printer.ts` seleccionan canales. Cámara/escáner/teclado/visor/cajón son parte del contrato operativo.

## Sync y flags

SyncManager coordina snapshots/deltas, configuración y catálogo; ApiSyncAdapter implementa HTTP master/ERP. BackgroundSyncManager drena operaciones pendientes y respeta actividad de venta. TransactionSyncService y SyncQueue conservan caminos legacy; CatalogEditQueue, CustomerSyncQueue y PosUserSyncQueue son colas especializadas.

DEFAULTS en SyncFeatureFlags: adaptive_polling, sync_hint_v2 y heartbeat_v2 true; private_realtime, sqlite_outbox_v2 y pending_operations_recovery false. Overrides de ambiente/dispositivo cambian el runtime; private_realtime prioriza política de ambiente. La presencia del código durable no demuestra que esté habilitado en producción ni que el receptor batch ERP esté desplegado.

## Tests, build e instrumentación

Ver comandos y límites en `WORKFLOW.md`. No hay script genérico `test` ni `typecheck`, ni configuración ESLint versionada encontrada. Node test/tsx incluye pruebas de lógica, contratos de texto y algunos roundtrips de adaptadores; la suite MJS de autorización private importa Vitest no declarado en package.json; no confundir grep de fuente con E2E de dispositivo. CI actual `apk-release-gate.yml` instala Node 22, verifica golden baseline y compila assets.

`utils/interactionPerformance.ts` registra handler/render/SQL/sync, inputToVisible, inputToInteractive, unlock, Long Tasks y heap opcional. `CheckoutPerformanceDiagnostics.ts`, CheckoutDiagnostics, startupTrace y SyncMetrics amplían evidencia. SyncMetrics persiste contadores y estado en localStorage, por lo que también puede añadir coste. `diagnostics/SELECTIVE.md` es vigente; el profiler masivo de README es histórico y no debe reactivarse. No se obtuvo baseline nueva de p95 ni sesión hardware en esta auditoría.

Inventario completo de fuentes y sus imports: [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md).
