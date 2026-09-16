# Flujos críticos

Auditoría estática: 2026-09-16. Fuente: `origin/develop` en `669f9624c85de40129169e6779aa6983f1441fea`. No certifica comportamiento en hardware ni estado desplegado del ERP. Las referencias son relativas a la raíz del repositorio.


Cada fila indica un recorrido observado en fuente y un contrato que QA debe demostrar. El éxito de HTTP no acredita persistencia/aplicación ERP.

## Venta y cobro

Artículo (`POSInterface`, barcode hooks, catálogo) → selección precio/variante/modificadores → cart en App → cantidades/promociones/impuestos/descuento → PaymentModal → autorización/métodos/fracciones/moneda/crédito/payment intent → construcción de Transaction y reserva de serie → `App.handleTransactionComplete` → persistencia local → publicación de estado → ticket/impresión/cajón → fiscal y sync en background.

El orden solicitado ticket/persistencia no es universal: deben distinguirse presentación, documento lógico y salida física. `handleTransactionComplete` publica React después de persistir; PaymentModal coordina impresión y éxito. `transactionService` normaliza fiscal/identidad/series, pero App contempla caminos que construyen Transaction sin ese servicio.

| Tramo | Archivos | Contrato y efectos |
|---|---|---|
| Producto → carrito | App, POSInterface, ProductForm, useBarcodeScanner, globalBarcodeCapture, cartQuantity, variantSalesPrice | No duplicar scan; cantidades válidas; tarifa/almacén/kit/variante correctos |
| Totales | promotionEngine, serviceTaxPolicy, taxSummary, taxIdentity, productTaxSnapshot, creditRules; App/POSInterface | Conservar redondeo, impuesto incluido/excluido, descuento por línea/global y servicio |
| Cobro | PaymentModal, paymentFractions, paymentSettlement, PaymentIntentService, AzulMcmService, IngenicoAzulWebApiService | Evitar doble cargo; conciliar intentos ambiguos; crédito requiere cliente/permisos/límite |
| Commit | App.handleTransactionComplete, transactionService, DurableOutboxRepository, db adapters | Legacy guarda documentos secuencialmente; durable guarda venta/history/ledger/tracking/deuda/eventos y payment intents atómicamente si flag y adaptador soportados |
| Postventa | backgroundSyncManager, fiscalService, processInventoryDeduction, printer services, receiptEmailService | No repetir ledger/deuda/NCF al reintentar; stock se recalcula diferido; fallo de impresora no implica repetir cobro |

Evidencia mínima: mismo ID estable, total = componentes según política, payments/vuelto/saldo correctos, una venta local y ERP, un movimiento por deducción esperada, secuencia sin doble incremento, impresión/reimpresión distinguibles. Tests iniciales: cartQuantitySafety, itemTaxAuthority, productTaxSnapshot, paymentFractions, paymentFractionPersistenceContract, salePostedContract y checkoutDiagnostics.

## Mesas

Mapa (`TableMap`) → selección/permiso/lock → mesa activa en App → parked ticket + productos → edición/guardar pedido/KDS → cambio de mesa total o parcial (`TableMoveConfirmationModal`, App, tableTicketIntegrity) → persistencia y refresh master/cliente → PaymentModal → cierre del ticket y liberación mesa.

La operación debe conservar líneas/cartId, cantidades, invitados, nombre temporal, tickets unidos y saldo. Origen y destino tienen contratos distintos al mover parcialmente o unir. Locks deben liberarse al salir/cancelar y no permitir sobrescritura concurrente. Android master HTTP participa en transporte; cliente no debe tratar offline del master como autorización para perder consistencia.

Tests: tableMove, tableMoveDestinationContract, tableSwitchLocalUnlockHotfix, joinedTableTicketPersistence, tablePaymentClosureContract, emptyTableChargeRegression, clientTableBatchSyncContract, tableAccountModalLockContract, tableAccessPolicy. E2E obligatorio con master y cliente: editar simultáneamente, guardar, salir, reentrar, mover a mesa vacía/ocupada, cobrar y verificar cierre visible desde ambos.

## Tickets, cierre Z y recuperación

Venta/pedido → parkedTickets o transactions/transactionHistory → TicketHistory/restauración → permisos → cobro/anulación/devolución → persistencia y sync. No reabrir como pendiente una venta perteneciente a cierre: ClosedTransactionMembership protege membership.

`App.handleZReport` toma configuración/secuencias, transacciones del período, cash movements y declaración → Z report + history/estado → impresión/correo → push/retry. `services/recovery/` aporta preparación y capturas, originales retenidos y restauración de cierre cuando flag habilitado. No certificar atomicidad global del camino legacy por existencia de recuperación opcional.

Tests: zReportPaymentSummary, zReportSequenceContinuity, zReportSyncRetry, closedTransactionMembership, closePreparation, recoveryAtomicAdapters, recoveryDurableRoundTrip y zReportEmailService. QA: diferencias declaradas, corte por terminal, cierre sin duplicar, restart antes/después de commit, impresión fallida, histórico, devolución y no reapertura por pull.

## Offline

Operación permitida por rol/política → persistencia local → pending/sync_queue o Outbox durable según flag → cierre/reinicio de proceso → reconexión → workers → API master/ERP → ack/aplicación → marcar sincronizado.

`useOfflineSync` trata recepción y conteo de inventario; no es el motor único de venta offline. Tiene localApplied/attempts/conflictos que impiden repetir efectos locales. useOfflineInventoryCountSync cubre otro flujo especializado. Venta usa BackgroundSyncManager, TransactionSyncService/SyncQueue y el sender durable cuando aplique.

Probar caída de red antes del envío, después de recepción ERP antes del ack, timeout/5xx, auth inválida, restart con pendientes, doble worker y recuperación de lease. Conservar eventId/aggregateId, datos y errores. No usar reset/seed/clear/uninstall para simular reconexión. Funciones que necesitan proveedor online (tarjeta, fiscal, cloud) deben conservar su política y estado pendiente, sin prometer disponibilidad offline.

## POS → ERP, ERP → POS y señales

| Ruta | Fuente/transportes | Verificación |
|---|---|---|
| POS → ERP legacy | BackgroundSyncManager → ApiSyncAdapter `/api/sync/transactions`, inventory/cash/Z; servidor local `server/services/erpInboxForward.ts` → `/api/sync/inbox` cuando corresponde | ack operacional válido; sync_id/disposición; no confundir APPLIED legacy con documento ERP real |
| POS → ERP durable | commit financiero + DurableOutboxRepository lease → DurableOutboxBatchSender → receiver API | eventId UUID estable, batch acotado, ack por evento, retry/terminal error; no borrar por HTTP 200 genérico |
| ERP → POS | SyncManager snapshots/deltas/manifest/config; ApiSyncAdapter; fences/preserveLocalCatalog/CatalogEditQueue | Cursor/version/scope correctos, edición local no rebotada ni perdida, impuestos/tarifa/usuarios coherentes |
| Realtime | RealtimeNotificationService, PrivateRealtimeAuthorization, RealtimeHintScope → SyncTriggerCoordinator | Hint scoped tenant/terminal; señal dispara reconciliación, no reemplaza DB durable; revocación bloquea dispositivo |
| Polling | AdaptivePollingScheduler, SyncManager | HEALTHY 5 min por defecto; degradación 5/10/20/40/60 s y jitter; fallo request con backoff; no loops superpuestos |
| Heartbeat | SyncManager, AuthenticatedActivityTracker, SyncFeatureFlags, SyncMetrics | Frecuencia/edad/estado coherentes, reducción idle no rompe señales o drain; flags medidos |
| LAN/operacional | server/routes/sync.ts, native-stubs/android/ClicPOSMasterHttpServer.kt, NetworkSyncService | No equivalencia asumida de Express y Kotlin; probar contratos master/cliente y ACK |

Tests: durableOutboxV2, durableOutboxBatchSender, operationalAcknowledgement, realtimeNotificationScope, realtimePollingContract, adaptivePollingScheduler, erpHeartbeatScheduler, syncTriggerCoordinator, catalogMultiTerminalRoundTrip. El código de Inbox receptor ERP y políticas Supabase desplegadas quedan fuera de esta auditoría; validar contra entorno de prueba real antes de release afectado.

## Actualización de auditoría: procedimiento interno

Fuente actual develop `669f9624c85de40129169e6779aa6983f1441fea`. Se reenumeraron 1055 archivos y se escanearon 818 fuentes. Se contrastó el delta operativo desde la auditoría anterior: App y masterOperationalApi ahora validan master vinculado/tenant/rol antes de usar rutas de mesas y otras operaciones; los timeouts de login cliente empiezan después de esa validación. Ver `tests/orderTakerMasterRouting.test.ts`, `tests/loginDestinationPerformance.test.ts`, `utils/terminalLoginLabel.ts` y `utils/interactionPerformance.ts`. No se cambió este código durante la instalación.

Cloud-Admin se inspeccionó en otro repo local; ver [CLOUD_ADMIN_DEPLOYMENT.md](CLOUD_ADMIN_DEPLOYMENT.md). El procedimiento separa code/internal/deployment/testing/production/released. Fuente inspeccionada no certifica estado desplegado ni rollout flags.

## Tickets: recorrido explícito

Listado TicketHistory/POSInterface → seleccionar transaction/parked ticket → abrir/editar App/cart → recuperar persisted draft/history o services/recovery → PaymentModal.onConfirm → App.handleTransactionComplete → closed membership/history → impresión y sync. Cada edición debe respetar permisos/cartId/qty/precio/impuesto/mesa/fracción; una transacción perteneciente a Z nunca reaparece pendiente por pull. Referencias tableTicketIntegrity, ClosedTransactionMembership, paymentFractionPersistenceContract, joinedTableTicketPersistence y closedTransactionMembership. Puntos de fallo: restored state obsoleto, master no validado, doble reserva/pago, cierre parcial y repetición después de ACK perdido. Fuente define orden real de persistencia antes de publicar UI; salida física no es commit financiero.
