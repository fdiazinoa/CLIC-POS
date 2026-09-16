# Arquitectura de sincronización

## Fuente y rutas

Fuente POS develop 669f9624c85de40129169e6779aa6983f1441fea (2026-09-16). SyncManager.initialize/pullCatalog/fullPull y ApiSyncAdapter coordinan master/ERP/config/catálogo; BackgroundSyncManager drena documentos pendientes y respeta actividad de venta. SyncQueue conserva sync_queue legacy. CatalogEditQueue/CustomerSyncQueue/PosUserSyncQueue conservan mutaciones especializadas. App escucha eventos/config y mantiene estado React además de DB.

## POS → ERP

`App.handleTransactionComplete` persiste venta local con syncStatus PENDING. Si `sqlite_outbox_v2` está activo y adaptador soporta commit, DurableOutboxRepository exige payload SALE_POSTED y usa commit financiero SQLite; si no, ruta legacy por documentos/pending. `DurableOutboxSchema.ts` crea sync_outbox_v2 con local_sequence autoincremental, event_id UNIQUE, aggregate_id, status/attempt_count/next_retry_at/lease_owner/lease_expires_at. Status: PENDING/SENDING/RETRY_WAIT/SYNCED_MASTER/APPLIED_ERP/REJECTED. Payment intents tienen idempotency_key UNIQUE y estados de autorización/reconciliación.

`DurableOutboxBatchSender.sendNext` recupera leases vencidas, obtiene lease y selecciona batch de hasta 25 transactions/50 eventos/512 KiB con reserva de envelope. ApiSyncAdapter.pushDurableOutboxBatch usa `/api/sync/inbox/batch`. eventId UUID estable identifica reintentos; local_sequence ordena elegibilidad local, no garantiza orden causal global en ERP. Respuesta se compara por eventId: APPLIED y variantes duplicate-applied → APPLIED_ERP; RECEIVED/STAGED/APPLY_PENDING/PROCESSING/SYNCED_MASTER → SYNCED_MASTER; missing/unknown/retryable → retryWait con backoff; rechazo final → REJECTED. No confundir receipt con procesamiento.

`server/routes/sync.ts` implementa transacciones/cash/Z/inventory y pending/ack locales. `server/services/erpInboxForward.ts` puede reenviar `/api/sync/inbox`; exige sync_id y distingue APPLIED legacy de documento ERP. Android master tiene otra implementación en `native-stubs/android/ClicPOSMasterHttpServer.kt`: transporte/ACK requiere pruebas equivalentes, no asumir servidor Node igual.

Se inspeccionó además CLIC-ERP local SHA 29653355b0f2c30ade13ed052a530973531af276: server/routes/syncInbox.js define erp_sync_inbox, storePosEventBatch y rutas /inbox y apply/pending. Esta inspección parcial no certifica receiver `/inbox/batch` disponible ni contrato desplegado. La flag durable permanece false por defecto hasta receiver compatible.

## ERP → POS y señales

RealtimeNotificationService.connect usa autorización PrivateRealtimeAuthorization, topics tenant/store y terminal, config private:true; SYNC_HINT v2 es filtrado por binding/scope y entregado a SyncTriggerCoordinator. El coordinador combina hints/versions y reconciliación, no sustituye persistencia. La preferencia private_realtime existe en flags, pero la conexión auditada exige canal privado: validar ambiente/auth real.

AdaptivePollingScheduler: healthy por defecto 5 min, connecting 20s, degradación 5/10/20/40/60s y jitter 60–120s; fallos request también retroceden. AuthenticatedActivityTracker, SyncProfile y SyncManager regulan heartbeat/idle; SyncMetrics guarda counters, pending hints/outbox, timestamps, last_erp_applied, batch y edades en localStorage. Metadata y versiones se persistieron en DB; eventos DOM como productsUpdated/config-sync y online/visibility activan estado/UI.

## Contratos y fallo

Ver CRITICAL_FLOWS y checklist sync: ONLINE/OFFLINE→ONLINE, ambos sentidos, duplicados, orden por aggregate, missing ACK, auth/revocation, lease tras crash, dos workers, snapshot/edición local, retries y recuperación. Tests durableOutboxV2/BatchSender, operationalAcknowledgement, catalogMultiTerminalRoundTrip, syncTriggerCoordinator, realtimePollingContract, adaptivePollingScheduler y erpHeartbeatScheduler son base; no sustituyen validación de documentos/ledger ERP y hardware. Sync-validator independiente se activa por storage/identity/sync/native/shared aunque no se toque un archivo de sync.
