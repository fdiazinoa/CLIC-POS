# Arquitectura offline

Fuente POS develop 669f9624c85de40129169e6779aa6983f1441fea, 2026-09-16. Factory services/db/index.ts: Android nativo → CapacitorSQLiteAdapter; web → IndexedDBAdapter; wrapper recoveryDatabase condicionado por pending_operations_recovery.

## Almacenes y límites

CapacitorSQLiteAdapter usa DB clic_pos_native sin cifrado declarado, tablas documents/storage_meta/sync_queue/master_number_ranges; commit financiero y Outbox/payment intents usan transacción SQL. IndexedDBAdapter migra almacenamiento antiguo y puede usar JSON/localStorage por fallback/cuota/colecciones pesadas; no equivale a atomicidad Outbox SQLite. server/db.ts abre server/db.sqlite con WAL y foreign_keys. NetworkAdapter/SQLiteWASM/LocalStorage existen pero no son selección por defecto. Preferences/localStorage conservan terminal/token/config/flags; PIN operativo y sesión cloud son diferentes.

## Recorridos

Venta/pedido permitido por política → persistir en DB → pending legacy o Outbox durable → reinicio/reconexión → BackgroundSyncManager/TransactionSyncService/SyncQueue/sender → master/ERP → ACK/processing → synced/applied. `App.handleTransactionComplete` publica React después de persistir; legacy guarda venta/ledger/tracking secuencialmente: pérdida de proceso entre pasos sigue riesgo. Recalcular stock es diferido y no acredita que efectos posteriores hayan terminado.

useOfflineSync cubre recepción/conteo (document types PURCHASE_ORDER/TRANSFER_IN/INVENTORY_COUNT), con queue status PENDING/SYNCING/ERROR, attempts y localApplied para evitar reaplicar localmente. useOfflineInventoryCountSync es especializado adicional; no describirlo como motor único de venta offline. `services/recovery/` conserva originales/epochs/preparation/captures/restore para operaciones/cierre con flag pending_operations_recovery false por defecto; presencia de código no certifica rollout.

## Seguridad de datos

Mantener transactionId/eventId/aggregateId/intent estable al reintentar. Cortar red antes de envío, durante recepción y tras apply antes de ACK; reiniciar proceso, recuperar leases y drenar con dos workers. Verificar uno por efecto de negocio: venta/ledger/deuda/series/Z; no basta eventual aparición del dato. Mesas cliente necesita master validado y mantiene restricciones si inaccesible. Cobro tarjeta/fiscal/cloud que requiera red conserva política y pending/error, sin prometer disponibilidad offline.

Tests iniciales recoveryAtomicAdapters, durableOutboxV2, backgroundSyncRecoveryContract, paymentFractionPersistenceContract, handheldInventorySync, terminalUpgradePersistence y tableAccountModalLockContract. QA y sync-validator independientes requieren fixtures/fault injection y web/Android pertinentes. No seed/reset/pm clear/uninstall/downgrade sobre datos operativos. Upgrade mantiene SQLite, identity/pairing/config/history/queues. El build release gate prebuild no certifica E2E offline en dispositivo.
