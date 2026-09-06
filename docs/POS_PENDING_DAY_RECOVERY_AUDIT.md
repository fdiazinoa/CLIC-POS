# Recuperación de operaciones pendientes de cierre — diagnóstico y contrato propuesto

Estado: fase 1 documental. No hay endpoints ni restaurador implementados por esta tarea.
Fecha de auditoría: 2026-09-06. Alcance de este hilo: CLIC-POS.

## 1. Conclusión y procedencia

Hoy puede recuperarse **parte de las operaciones que efectivamente llegaron al ERP**, si su payload original conserva los campos necesarios. No está demostrada la recuperación exacta de toda la jornada pendiente ni la equivalencia del cierre Z después de perder la base local. Faltan pertenencia explícita al cierre, cobertura de abonos/asignaciones y evidencia del extremo no sincronizado del dispositivo.

Fuentes fijadas para reproducibilidad:

- POS: `origin/develop`, commit `5993b1fed18c230dde89734e91fa94e0a95ce2bc`. Las referencias POS de este documento corresponden a ese commit, no a la rama sucia del directorio principal.
- ERP: revisión previa de `origin/clean-erp`, commit `689ada57f5c5c1d35c327607295892aef40a47db`. Se entrega como evidencia para que el hilo ERP confirme vigencia y despliegue; no se continuará modificando ERP desde este hilo.
- Supabase: consultas **SELECT** de catálogo y agregados al proyecto `cdfdgxejnbznjxuokrrx` (Clic-Pos), realizadas en esta conversación el 2026-09-06. No se consultó la tablet del cliente, no se eligió una empresa/terminal afectada y no se exportaron documentos comerciales individuales. Los conteos globales no certifican el respaldo de una terminal.
- No se verificó que el backend desplegado coincida con el commit ERP. No se ejecutaron operaciones, reintentos, backfills, ventas ni cierres de prueba.

El pairing, la revinculación y la exclusión del dispositivo sustituido se reutilizan. Las rutas y campos nuevos que siguen son **propuestas**, pendientes de validación ERP–POS.

## 2. Índice de evidencia de código

Los enlaces fijan el commit para evitar que cambien los números de línea.

| Clave | Evidencia |
|---|---|
| P1 | [POS App.tsx:4722](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/App.tsx#L4722): selectores pendientes; :10047 cierre; :10165 openedAt; :10264 construcción del Z; :10391 archivo y retirada local. |
| P2 | [POS types.ts:1763](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/types.ts#L1763): Transaction; :2163 CashMovement; :2358 PaymentEntry; :3023 CollectionAllocation/Collection. |
| P3 | [POS ZReportDashboard.tsx:233](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/components/ZReportDashboard.tsx#L233): selección, listas de IDs y cálculo de efectivo :390–436; `utils/paymentSettlement.ts:35–72`; `utils/analytics.ts:3` estadísticas y :98–102 anticipos/abonos. |
| P4 | [POS erpOutboundPayloads.ts:124](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/services/sync/erpOutboundPayloads.ts#L124): saneamiento de renglones, buildErpSalePayload :164, movimiento :212, Z :227. |
| P5 | [POS ApiSyncAdapter.ts:5036](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/services/sync/ApiSyncAdapter.ts#L5036): venta; :5382 movimientos; :5397 Z; :5438 batch; :5450 pullPendingTransactions, destinado a Master local. |
| P6 | [POS BackgroundSyncManager.ts:31](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/services/sync/BackgroundSyncManager.ts#L31): colecciones operacionales; `DurableOutboxBatchSender.ts:199–226` clasifica ACK; `DurableOutboxRepository.ts:311–329` recibido/aplicado; `DurableOutboxSchema.ts:1`. |
| P7 | [POS AccountReceivableModal.tsx:245](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/components/AccountReceivableModal.tsx#L245): abono, asignaciones y cambios de saldos; `services/AgendaService.ts:513–528` anticipo local. |
| P8 | [POS CapacitorSQLiteAdapter.ts:190](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/services/db/adapters/CapacitorSQLiteAdapter.ts#L190): commit financiero/outbox; :477 `documents(collection_name,doc_id,data,...)`; `IndexedDBAdapter.ts:22–32` colecciones web. |
| P9 | [POS server/routes/sync.ts:2098](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/server/routes/sync.ts#L2098): cola pending Master; :2337 inserción de efectivo; :2374 Z. `server/schema.sql` es SQLite del servidor local, NO esquema Supabase ERP. |
| P10 | [POS ZReportRecoveryService.ts:55](https://github.com/fdiazinoa/CLIC-POS/blob/5993b1fed18c230dde89734e91fa94e0a95ce2bc/services/recovery/ZReportRecoveryService.ts#L55): reconstruye desde transactionHistory. `components/AnalyticsLogic.ts:79` identifica fondos por texto del motivo. |
| E1 | [ERP syncInbox.js:2531](https://github.com/fdiazinoa/CLIC-ERP/blob/689ada57f5c5c1d35c327607295892aef40a47db/server/routes/syncInbox.js#L2531): merge/recepción/deduplicación; :2669 auth; :3931 venta original; :4040 movimiento; :4064 Z; :9541 batch; :9715 listado de ventas. |
| E2 | [ERP posEventApplier.js:2782](https://github.com/fdiazinoa/CLIC-ERP/blob/689ada57f5c5c1d35c327607295892aef40a47db/server/services/posEventApplier.js#L2782): transformación de líneas; :3889 factura; :4080–4245 cobro derivado; :4474–4538 ventana de cierre; :4710–4840 aplicación/estados. |
| E3 | [ERP posZReportService.js:480](https://github.com/fdiazinoa/CLIC-ERP/blob/689ada57f5c5c1d35c327607295892aef40a47db/server/services/posZReportService.js#L480): lectura por fechas, límite 5000 y posterior filtro de ventana. `server/routes/pos.js:7,30` GET Z para ERP; `server/index.js:194,209` montaje `/api/sync`, `/api/pos`. |
| E4 | [ERP posSyncEventOutcome.js](https://github.com/fdiazinoa/CLIC-ERP/blob/689ada57f5c5c1d35c327607295892aef40a47db/server/services/posSyncEventOutcome.js): duplicate/applied/pending separados. `server/services/posSequenceSync.js:175,230,242` avances documentales/fiscales. |
| E5 | [ERP migración batch](https://github.com/fdiazinoa/CLIC-ERP/blob/689ada57f5c5c1d35c327607295892aef40a47db/supabase/migrations/20260822171058_erp2b_receive_inbox_batch.sql): guarda payload en erp_sync_inbox. Migraciones `20260822134518_harden_sync_inbox_rls.sql`, `20260822134522_scope_sync_inbox_event_id_by_tenant.sql`. |
| E6 | [ERP syncMasterCollections.js:1165](https://github.com/fdiazinoa/CLIC-ERP/blob/689ada57f5c5c1d35c327607295892aef40a47db/server/services/syncMasterCollections.js#L1165): mesas desde businessConfig; es configuración, no pedidos abiertos. |

## 3. Matriz de cobertura

“Condicional” significa que hay una fuente utilizable si ese documento llegó y supera validación; no significa que exista ya un endpoint de restauración.

| Dato requerido | Fuente exacta | Cuándo se sincroniza | Conservado / perdido o no demostrado | Recuperación |
|---|---|---|---|---|
| Venta original | Local `documents` con colección `transactions`/`transactionHistory`, o IndexedDB; ERP `erp_sync_inbox.payload.transaction`, eventos SALE_POSTED (P2/P4/P8/E1/E5) | Envío operacional/batch después de persistir, sujeto a perfil, feature flags, red y worker (P5/P6) | IDs source/display, líneas, impuestos, descuentos, pagos y settlement en el registro recibido. El payload ERP ya pasó por normalización POS; no es copia byte a byte de SQLite. | Condicional. Validar forma, importes y referencias; 1 venta recibida no tiene líneas no vacías. |
| Líneas, impuestos/descuentos originales | `transaction.items`, taxBreakdown, taxAmount, netAmount, discount* (P2/P4) | Con venta | POS excluye atributos/variantes maestras, tarifas, imágenes, stockBalances, definiciones de modificadores/combos, etc.; elimina referencias de tarifa no UUID. Campos seleccionados del ticket no deben recomponerse desde catálogo actual. | Condicional para cálculo; no respaldo íntegro del catálogo ni del estado restaurante. |
| Pagos, moneda, recibido/aplicado/cambio | `transaction.payments`, settlement*; evento PAYMENT_POSTED `payload.payments` y summary (P2/P3/E1) | Con venta por ruta legacy; batch depende de los eventos emitidos, no asumir misma derivación | IDs de pago, amount, amountOriginal, appliedAmount, changeAmount, currencyCode, exchangeRate, changeCurrencyCode pueden conservarse. PAYMENT_POSTED contiene pagos de liquidación filtrados; no sustituye el conjunto original. | Condicional. Deduplicar pago embebido/evento, no sumar ambos. |
| Factura y recibo ERP derivados | `erp_sales_documents`, `erp_sales_document_items`; metadata; `erp_journal_entries.descripcion` JSON en modo por documento (E2) | Al aplicar el evento | Nuevos IDs ERP; fecha comercial, redondeo y líneas transformadas; metadata preserva parte de pagos/FX/identidad. Recibo con asignación a factura ERP y agrupación contable, no Collection original. Fallback de líneas conserva solo document_id/item_id/cantidad/precio_unitario/impuesto. | No autoritativos para rehidratar POS. Usar solo reconciliación y vínculo de IDs ERP. |
| Devolución/nota crédito | Transaction REFUND con originalTransactionId, affectedNCF/affectedInvoiceNumber y pagos; ERP SALES_CREDIT_NOTE_POSTED `payload.transaction` (P2/P4/App :10664/E1) | Persistencia de devolución y envío operacional | Documento de devolución separado; estado actualizado de la venta original no garantiza nueva versión en inbox. Signo comercial y reembolso dependen del método. | Condicional para NC recibida; validar ambas relaciones y mutaciones de original. |
| Anulación | Transaction/documentType VOID y metadata de pasarela; analytics excluye VOID (P2/P3) | No se identificó un evento general de anulación/versionado que cubra toda modificación posterior | E1 deriva nota por REFUND o fiscal B04/E34, no prueba contrato general de VOID. Anular tarjeta no equivale a respaldar anulación comercial. | Brecha: tipificar casos y capturar revisión/tombstone; no convertir en venta ni inferir de ausencia. |
| Efectivo IN/OUT | Local cashMovements; ERP CASH_MOVEMENT_POSTED `payload.movement` (P2/P4/P5/E1) | Worker o push individual | Registro conserva amount, currencyCode, timestamp, reason, usuario e IDs si llegaron. Summary ERP usa concept/createdAt y puede diferir de reason/timestamp; usar original. Master SQLite inserta columnas acotadas, sin currencyCode en ese INSERT (P9). | Condicional ERP directo; camino Master requiere verificar pérdidas. Recibido no significa aplicado contablemente. |
| Fondo/apertura | Movimientos IN y motivo; config workflow.session.requireCashFundOnZ/fixedCashFundAmount; Z guarda fondo/dejar/retirar (P1/P3/P10) | Movimiento/config/Z, cada uno por su camino | Política de fondo no demuestra efectivo realmente ingresado. Heurística por texto en analytics; no identidad durable de apertura encontrada. | Solo movimiento explícito recibido. No inventar apertura desde configuración o openedAt. |
| Abonos CxC y allocations | `collections`: id/displayId/series, recibido original/base, aplicado/no aplicado, allocations con id/collectionId/transactionId/amount/timestamp (P2/P7) | Persistencia local; worker operacional P6 no incluye collections | No se localizó endpoint/evento ERP equivalente con Collection y asignaciones originales. Cambiar pendingBalance de venta o currentDebt no respalda el recibo. Generic sync de colección no prueba persistencia operacional ERP. | No demostrada desde ERP. Brecha prioritaria. |
| Anticipos | AgendaService guarda Collection con allocations según caso; walletDepositAmount y WALLET_MOVEMENT_POSTED son otro canal (P7/P3/E1) | Local para agenda; wallet sujeto a emisor/worker | Wallet no equivale a anticipo agenda ni a abono CxC. Preservar recibido/aplicado/no aplicado y destino. | Parcial; especificar cada canal, no unificar por total. |
| Z original y detalle | Local zReports; ERP CASH_CLOSE_POSTED `payload.report` y summary (P1/P5/E1) | Guarda Z local y luego push; archiva operaciones después, sin transacción única global | ID Z, serie, totales, detalle de efectivo, declaración, stats. Falta manifiesto persistido de IDs de ventas/abonos. | Z recibido puede restaurarse como cierre existente, aun si ACK se perdió. No permite inferir todos sus miembros. |
| Pertenencia exacta | `transactionHistory.zReportId/zReportSequence` local; listas temporales del modal (P1/P3) | Se asigna al archivar después de enviar Z | newZReport no incorpora listas transactionIds/collectionIds; cashMovementDetails conserva algunos IDs. Abonos y movimientos se retiran de colecciones activas sin archivo equivalente en este flujo. | No exacta desde ERP histórico. Ausencia de zReportId remoto NO prueba pendiente. |
| Fiscal/series | Transaction ncf/electronicNcf/fiscalReferenceId/seriesId/seriesNumber; local internalSequences/fiscalRanges; ERP erp_document_series, erp_fiscal_ranges, erp_terminal_fiscal_allocations (P1/P2/E4) | Con operaciones y sincronización de configuración/progreso; depende de ACK/aplicación y canal | Avance remoto puede desconocer números usados offline; snapshots fiscales posteriores pueden no estar en evento inicial. | Referencias recibidas sí, contador seguro solo con reconciliación y reservas. Nunca bajar ni reutilizar. |
| Mesas/pedidos abiertos | Local tables/parkedTickets, servicios de mesa y Master; ERP masters.tables desde businessConfig (P8/E6) | Estado local/LAN; catálogo ERP separado | Configuración de mesas no incluye necesariamente cuenta, líneas, splits, cursos, KDS, ocupación y pagos parciales abiertos. | No demostrado desde ERP. Fuera de fase 1; diseñar respaldo versionado restaurante posterior. |

## 4. Evidencia de esquema y datos existentes (solo lectura)

`erp_sync_inbox` tiene `id uuid`, `event_id uuid`, `tenant_id/store_id/terminal_id uuid`, `event_type`, `payload jsonb`, `status sync_status`, `last_error`, `processed_at`, `created_at`. No tiene columna company_id, versión de snapshot ni pertenencia a cierre. Company debe resolverse y corroborarse con contexto/payload; no inventar columna.

Índices reales consultados: PK id; UNIQUE global event_id; UNIQUE parcial (tenant_id,event_id) cuando tenant_id no es NULL. La unicidad global sigue vigente: validar colisiones históricas/IDs entre ámbitos antes de prometer cualquier nueva estrategia de IDs. `sync_inbox` también existe, pero su agregado devolvió cero filas; no confundir tablas.

| Tipo en erp_sync_inbox | APPLIED | RECEIVED | FAILED |
|---|---:|---:|---:|
| SALE_POSTED | 1224 | 0 | 38 |
| PAYMENT_POSTED | 1179 | 0 | 48 |
| SALES_CREDIT_NOTE_POSTED | 13 | 0 | 0 |
| CASH_CLOSE_POSTED | 26 | 50 | 0 |
| CASH_MOVEMENT_POSTED | 0 | 4 | 0 |
| WALLET_MOVEMENT_POSTED | 0 | 9 | 0 |

Otros tipos también existen; esta tabla no pretende inventariar toda la actividad del sistema. Las consultas se hicieron en instantes separados, no constituyen un snapshot operacional.

Pruebas de forma agregadas: 1262 SALE_POSTED con transaction/pagos, 1261 con items no vacíos; 13 NC con transaction/items/pagos. Ninguna de esas ventas/NC con `transaction.zReportId`. De 76 Z, ninguno con `report.transactionIds` ni `report.collectionIds`; 42 contienen la clave cashMovementDetails (su presencia no prueba contenido/completitud). Los 4 movimientos contienen currencyCode/timestamp. No se asumió que otros alias estén ausentes solo por estas consultas: el diagnóstico se apoya también en el emisor POS.

No se encontró una entidad de sesión de caja en los tipos/persistencia auditados. Los sessionId de auditoría de inventario o diagnóstico no son una sesión operacional. El inventario de tablas no prueba ausencia absoluta en otros servicios no inspeccionados; el ERP debe confirmar este punto.

## 5. Frontera de jornada

1. P1 usa terminal/aliases, ausencia de zReportId y fecha posterior a último closedAt menos cinco minutos para ventas. Movimientos usan terminal y esa tolerancia, sin relación de cierre en el tipo. En fallback, abonos usan terminal y ausencia de zReportId. El modal pasa listas explícitas del conjunto seleccionado, pero no se persisten todas en el Z.
2. openedAt es mínimo de ventas y movimientos; **no incluye collections**. Una jornada solo de abonos puede tomar la hora del cierre como apertura. No es una sesión durable.
3. Medianoche no termina una jornada. Sin un cierre explícito, operaciones de varios días forman el conjunto pendiente; no se pueden separar “varias jornadas” por fecha sin evidencia adicional.
4. Los servicios ERP de auditoría/asignación contable de Z usan ventanas; E3 limita lectura por recepción a fechas de apertura/cierre y 5000 filas. E2 busca candidatos desde apertura menos 24 horas, tope 25000, luego filtra ocurrencia. Esto puede excluir llegadas tardías y no equivale a pertenencia exacta. `application.accounting_cash_close_event_id` identifica contribución contable, no garantiza membresía completa de efectivo/abonos/documentos.
5. Para registros nuevos se propone **un conjunto abierto por terminal con pertenencia explícita**, no session_id. Un `openSetId` nuevo solo identificaría el conjunto desde que se emita/persista; no puede asignarse retroactivamente a la historia como si hubiera existido una sesión. Un manifiesto de cierre debe relacionar IDs+revisiones y previo cierre. El servidor devuelve membership `OPEN`, `CLOSED` o `UNKNOWN`; para legado sin prueba, UNKNOWN.
6. Si existe Z recibido con ID/eventId original, restaurar ese Z y su estado; no generar otro ID/número, no volver a cerrar. Si solo se conserva el cierre pero no sus miembros, conservar la incertidumbre y bloquear certificación exacta. No invocar reprocess/apply como parte de recuperar.

## 6. Recepción, aplicación y estado local

| Evidencia ERP | Estado de recuperación propuesto | Reenvío desde restaurador |
|---|---|---|
| APPLIED con resultado verificable | remoteReceipt=RECEIVED; remoteApplication=APPLIED | Ninguno. Importar sin ejecutar lógica comercial. |
| RECEIVED/STAGED/APPLY_PENDING | remoteReceipt=RECEIVED; remoteApplication=PENDING | Ninguno. Mostrar pendiente ERP y observar estado. |
| PROCESSING | remoteApplication=PROCESSING | Ninguno. No competir con worker ERP. |
| FAILED | remoteApplication=FAILED + error/retryable/efectos parciales conocidos | Ninguno automático. Reconciliación ERP por identidad existente. |
| DUPLICATE sin estado subyacente | remoteApplication=UNKNOWN | No tratarlo como aplicado. Consultar estado autoritativo. |
| Solo sync_events legacy con APPLIED nominal | remoteApplication=UNKNOWN salvo evidencia de aplicación real | No esconderlo como completado. E1 advierte fallback APPLIED sin applier. |
| Documento local que ERP no conoce | localDelivery=PENDING, origin=LOCAL | Conservar cola/ID originales, fuera del importador. Solo sender normal y reconciliación idempotente validada. |

P6 ya distingue SYNCED_MASTER/APPLIED_ERP, pero acepta `DUPLICATE` genérico como aplicado: no reutilizar esa inferencia para restauración. Los flags syncStatus actuales por sí solos no representan estas dimensiones. `APPLIED` tampoco significa necesariamente contabilidad finalizada: puede estar diferida al Z; incluir estado por efecto (comercial, cobro, inventario, contabilidad), vínculo y errores. FAILED puede tener efectos parciales y nunca autoriza repetirlos ciegamente.

El importador no llama checkout, persistStandaloneRefundTransaction, commitFinancialTransaction, apply/reprocess, ajustes de deuda/inventario/wallet, impresión fiscal ni emisión de documentos. Usa escritura de restauración transaccional sin outbox y con origen remoto. Los workers deben excluir explícitamente este origen incluso al reparar estados “atascados”.

## 7. Contrato HTTP propuesto, pendiente de validar

### Autenticación y alcance

Reutilizar `resolveAuthorizedTerminal`, `assertCanonicalDeviceAuthorization`, contexto tenant/company/store del ERP y el token vigente de sync. Propuesta: `X-Sync-Token` y `X-Device-Id` como en el flujo operacional; confirmar cabeceras exactas con el ERP. Validar autorización en **cada página**, no solo al crear snapshot. Un takeover durante descarga invalida el cliente anterior mediante el mecanismo existente.

No aceptar tenant/company/terminal del body como autoridad. Contexto derivado de credencial canónica, con UUID de terminal y aliases históricos verificables. Empresa no se infiere solo de nombre/T1. Si la terminal cambió de empresa/sucursal y el registro no permite probar su ámbito original, informar SCOPE_UNRESOLVED y no mezclar datos. Aplicar aislamiento en consultas y en todos los recursos/cursors; sin service_role en POS.

### Rutas

| Ruta propuesta | Función / respuesta |
|---|---|
| `POST /api/sync/recovery/snapshots` | Body `{contractVersion:1, scope:"UNCLOSED_OPERATIONS", includeClosedReferences:true}`; `Idempotency-Key` obligatorio. Crea artefacto de lectura consistente, sin aplicar eventos. 201 creado o 200 misma petición. |
| `GET /api/sync/recovery/snapshots/:snapshotId` | Manifiesto inmutable, 200; ETag del manifiesto. |
| `GET /api/sync/recovery/snapshots/:snapshotId/records?cursor=...&limit=200` | Primera página sin cursor; páginas estables 200. Límite máximo propuesto 500, confirmar presupuesto en bytes. Nunca truncamiento silencioso. |
| `GET /api/sync/recovery/snapshots/:snapshotId/status` | Estado actual de eventos, revisión de pertenencia/cierres y series desde el corte; separado de páginas inmutables. Permite saber si el conjunto cambió antes de activar. |
| `POST /api/sync/recovery/snapshots/:snapshotId/receipts` | Opcional: ACK técnico `{manifestHash, importedCount}` idempotente. No cierra jornada, aplica eventos, borra registros ni altera su entrega. |

Ejemplo esquemático de manifiesto (IDs/hash son marcadores, no datos de cliente):

```json
{
  "contractVersion": 1,
  "snapshotId": "snap-example",
  "scope": {"tenantId": "tenant-example", "companyId": "company-example", "storeId": "store-example", "terminalId": "terminal-example"},
  "cut": {"revision": "rev-41", "capturedAt": "2026-09-06T16:00:00Z"},
  "expiresAt": "2026-09-07T16:00:00Z",
  "boundary": {"kind": "EXPLICIT_MEMBERSHIP", "openSetId": null, "previousCloseId": null, "membershipStatus": "UNKNOWN"},
  "coverage": {
    "downloadIntegrity": "VERIFIABLE",
    "deviceCoverage": "UNKNOWN",
    "membershipCoverage": "INCOMPLETE",
    "exactZEligible": false,
    "knownMissing": [{"kind": "COLLECTION", "reason": "NO_VERIFIED_BACKUP_CHANNEL", "ids": null}],
    "unknownTailPossible": true,
    "evidence": {"lastDeviceCheckpoint": null, "receivedWatermark": null, "sequenceGaps": []}
  },
  "counts": {"records": 1, "transactions": 1, "paymentsEmbedded": 1, "cashMovements": 0, "collections": 0, "closeReferences": 0, "remoteFailed": 0},
  "totals": {
    "baseCurrency": "DOP",
    "moneyScale": 2,
    "byCurrencyAndMethod": [{"currency": "USD", "methodId": "CASH", "receivedOriginal": "10.00", "receivedBase": "600.00", "appliedBase": "550.00"}],
    "changeByCurrency": {"DOP": "50.00"},
    "knownDrawerNetByCurrency": {"USD": "10.00", "DOP": "-50.00"}
  },
  "integrity": {"algorithm": "SHA-256", "canonicalization": "CONTRACT_V1_CANONICAL_JSON", "manifestHash": "sha256-example", "recordsRootHash": "sha256-example"},
  "series": {"status": "RECONCILIATION_REQUIRED", "items": []},
  "nextCursor": "opaque-example"
}
```

Esta suma representa **solo el conjunto conocido**, una venta de 550 DOP pagada con 10 USD a 60 y cambio de 50 DOP. No demuestra que hubiera cero fondo, cero abonos ni cero otras ventas. No sumar USD y DOP en un total sin conversión histórica explícita. Desglosar además ventas/devoluciones/anulaciones, impuestos/descuentos, entradas/salidas, abonos/anticipos aplicados/no aplicados y dependencias fuera del conjunto abierto.

Ejemplo de registro abreviado para mostrar la envoltura; el esquema final debe exigir TODOS los campos operacionales del tipo, no solo estos:

```json
{
  "snapshotId": "snap-example",
  "records": [{
    "kind": "TRANSACTION",
    "originalId": "TX-original",
    "originalRevision": null,
    "recordHash": "sha256-example",
    "sourceEventIds": ["event-original"],
    "membership": {"state": "UNKNOWN", "zReportId": null, "evidence": "LEGACY_NO_MANIFEST"},
    "remote": {"receipt": "RECEIVED", "application": "APPLIED", "effects": {"accounting": "DEFERRED_TO_Z"}, "erpDocumentId": "erp-document-example", "error": null},
    "relationships": {"paymentIds": ["payment-original"], "originalTransactionId": null},
    "original": {
      "id": "TX-original", "displayId": "TCK-000123", "terminalId": "terminal-example",
      "date": "2026-09-05T23:55:00-04:00", "documentType": "TICKET", "total": 550,
      "items": [{"id": "item-original", "name": "Ejemplo", "quantity": 1, "price": 550}],
      "payments": [{"id": "payment-original", "method": "CASH", "amount": 600, "currencyCode": "USD", "amountOriginal": 10, "exchangeRate": 60, "appliedAmount": 550, "changeAmount": 50, "changeCurrencyCode": "DOP"}]
    }
  }],
  "nextCursor": null
}
```

En legado sin revisión demostrable, originalRevision es null; no fabricar una versión histórica.

Los IDs originales no se reemplazan por IDs de factura/asiento ERP ni por nuevos UUID. Referencias a facturas antiguas de allocations/devoluciones deben incluir documentos de dependencia (read-only, fuera del cierre abierto) o declarar faltantes; no importar esas facturas como nueva actividad pendiente. Pagos embebidos son la unidad monetaria canónica de venta; los eventos de pago aportan estado/vínculo, no una segunda entrada de efectivo.

### Corte, integridad y reanudación

- `created_at <= corte` por sí solo NO es snapshot: payload y estado se actualizan en el mismo registro. Propuesta mínima: materializar en una transacción de lectura consistente un artefacto de recuperación con contenido, pertenencia y estados congelados; definir retención/TTL (24h arriba es propuesta). Alternativa válida: almacenamiento versionado con lectura por revisión. Validar costo/retención antes de elegir.
- Cursor opaco ligado a snapshot, ámbito, versión y posición en orden fijo (kind, originalId, revision). Sin OFFSET sobre datos vivos. Misma página devuelve mismos registros y hashes, independientemente de eventos recibidos o aplicados después del corte.
- Especificar canonicalización completa antes de implementar: claves ordenadas recursivamente, UTF-8, tratamiento único de números/null/ausente y exclusión de recordHash del contenido que se firma. SHA-256 sobre ese contenido; raíz sobre lista ordenada de kind/ID/revision/hash. No usar hash de JSON reserializado libremente por cada plataforma. Publicar fixtures de bytes y hashes.
- Counts por entidad, relaciones, revisión y estado; totales decimales por moneda/método; detectar referencias rotas, IDs repetidos con diferente contenido, monedas/tasas desconocidas y truncamiento. Hashes verifican transporte y consistencia del conjunto, no operaciones que nunca salieron del dispositivo.
- POS descarga a staging separado con cursor/hash persistidos. Retomar tras reinicio con mismo snapshot. Repetición de página/ACK no crea duplicados. Si expiró, crear nuevo snapshot y no mezclar páginas anteriores.
- Estados nuevos se obtienen aparte. Antes de activar, comparar revisión de membresía/cierres/series; si hubo cierre, nueva operación o revisión que altere el conjunto, reconciliar por IDs o reiniciar snapshot. Un checkpoint local de activación debe hacer atómica la transición. Para un corte final exacto hace falta una condición de revisión verificada por ERP; no prometer que un GET de status elimina por sí solo una carrera posterior.
- No permitir cierre definitivo del conjunto recuperado mientras pertenencia/cobertura estén sin resolver. Operaciones nuevas de la tablet, si las hay, permanecen en conjunto local separado; no mezclarlas por fecha con la descarga. No se borra lo local para instalar el snapshot.

### Errores propuestos

Formato: `{error:{code,message,retryable,details},requestId}`; details sin secretos/datos de otra empresa.

| HTTP | Código / manejo |
|---|---|
| 400 | INVALID_CURSOR / UNSUPPORTED_CONTRACT: corregir cliente, no borrar staging. |
| 401 | SYNC_AUTH_REQUIRED: reautenticar por flujo existente. |
| 403 | Código existente de dispositivo sustituido/inactivo o RECOVERY_SCOPE_FORBIDDEN; detener acceso. |
| 404 | SNAPSHOT_NOT_FOUND (también recurso ajeno, sin filtrar existencia). |
| 409 | IDEMPOTENCY_KEY_REUSED (body distinto), RECOVERY_CUT_CHANGED, ORIGINAL_ID_CONFLICT, SCOPE_UNRESOLVED. No sobrescribir. |
| 410 | SNAPSHOT_EXPIRED: nueva captura, staging independiente. |
| 422 | PAYLOAD_NOT_RECOVERABLE / SERIES_UNSAFE: describir evidencia faltante. Manifest parcial puede ser 200 con exactZEligible=false; 422 solo si no se puede producir el recurso solicitado. |
| 429/503 | Retry-After; reintentar mismo cursor/key sin inventar ACK. |

### Series y fiscal

Entregar seriesId/tipo/prefijo/alcance, nextNumber remoto, máximo usado conocido, reservas y límite del bloque. POS combina `max(localNext, remoteNext, knownUsed+1)` **solo dentro de la misma serie y reserva válida**. Esto no resuelve números consumidos en cola perdida: si no puede probarse la parte libre del bloque previo, no reutilizarla; ERP debe definir avance conservador o asignación de un bloque nuevo conforme al mecanismo vigente. No cambiar normativa fiscal desde este contrato.

Restaurar una factura/NC/Z ya emitidos nunca consume otro número ni envía de nuevo al proveedor fiscal. Conservar respuesta/referencia fiscal y distinguir emisión pendiente de documento ya emitido con ACK perdido. Deshabilitar fallback Z basado en cantidad de reportes para una terminal recuperada hasta reconciliar series. Estado fiscal ausente no se convierte en “no emitido”.

## 8. Brechas y cambios mínimos propuestos

| Prioridad | Brecha / responsable | Cambio mínimo y decisión pendiente |
|---|---|---|
| P0 | Pertenencia POS + ERP | Persistir manifiesto de Z (transactionIds, cashMovementIds, collectionIds, revisiones, previousCloseId) junto al cierre local antes de archivar; conservarlo remoto. Aplicarlo para selección exacta. Legado UNKNOWN, sin backfill por fechas presentado como exacto. |
| P0 | Abonos/anticipos POS + ERP | Persistencia duradera y evento específico con Collection completa, allocations y relaciones. Extender cola fuera del camino de red del cobro; receptor/almacenamiento independiente de efectos comerciales. No reutilizar PAYMENT_POSTED de una venta como abono genérico. |
| P0 | Snapshot/estados ERP | Validar esquema y fuentes por empresa/terminal; endpoint de lectura consistente con estados separados y cobertura explícita; no usar applier para leer. |
| P0 | Importador POS | Staging, ID+revisión, transacción de activación, marca de origen y exclusión de workers. Ninguna llamada que reaplique saldos/inventario/cobros. |
| P0 | Cobertura y series ambos | Checkpoint operacional durable por época de almacenamiento/terminal, secuencia monotónica y lista/rango de eventos esperados; ACK contiguo y huecos. Incluso último checkpoint completo no prueba ausencia de una cola posterior nunca comunicada. Definir UX y restricción del Z exacto. |
| P1 | Mutaciones POS + ERP | Originales versionados de devoluciones/anulaciones/estado fiscal/asignaciones; mismo ID con revisión nueva, sin sobreescribir silenciosamente versión anterior ni reenviar evento financiero para actualizar metadata. |
| P1 | Paridad de cálculo POS | Congelar configuración relevante y versión del cálculo. ZDashboard actual incluye collections en stats, pero efectivo esperado :390–436 solo suma pagos y movimientos; revisar inclusión de abonos monetarios por separado. No “corregir” al restaurar silenciosamente y afirmar el mismo Z. |
| P1 | Efectivo y apertura | Tipificar propósito de movimiento OPENING_FUND en nueva versión, con moneda/importe/fecha original; no hacer sesión de caja a partir de texto. Verificar camino LAN que pierde campos. |
| P2 | Restaurante | Contrato independiente de cuentas/pedidos abiertos versionados, cancelaciones, splits, ocupación, KDS y pagos parciales; configuración de mesas no basta. |

La persistencia local del documento y su evento debe ser atómica; el envío continúa en background con backoff y ACK individual. Extender lo existente con cambios pequeños y feature flag. El cierre actual guarda Z, envía, archiva ventas y retira movimientos/abonos en pasos separados: el manifiesto/outbox atómicos deben resolver la ventana de caída sin bloquear por red. Nunca eliminar la última copia operacional pendiente por un ACK meramente recibido.

## 9. Pruebas de aceptación propuestas (no ejecutadas contra datos reales)

Usar fixtures sintéticos y bases temporales aisladas; mocks/spies del aplicador, pasarela, inventario, contabilidad y outbox. La operación de restauración debe producir **cero** llamadas a esos efectos. No crear ventas/cierres de prueba en producción.

| Caso | Preparación y aserción |
|---|---|
| Paridad Z | Mismo conjunto de IDs/revisiones y configuración antes/después; igualdad de totales por método/moneda, impuestos, descuentos, retornos, anticipos/abonos, cashExpected, IDs y pertenencia. cashCounted y discrepancia comparables solo con idéntica declaración física suministrada, no inventada. |
| Interrupción/repetición | Cortar cada página y antes/después de activar, reiniciar, repetir snapshot/ACK. Conteo y hash iguales; cada ID una vez; ninguna operación a medio importar visible. |
| Z ya recibido y ACK perdido | Z existente tanto RECEIVED como APPLIED; conservar ID/serie, estado ERP y miembros. No crear otro Z ni incrementar secuencia. Sin miembros, mostrar incertidumbre. |
| Pendiente/fallido | Venta APPLIED y pago FAILED; PROCESSING, STAGED, APPLY_PENDING, DUPLICATE ambiguo y fallback legacy. Estado por evento visible; cero reenvíos automáticos desde importador. Incluir efectos parciales y contabilidad diferida. |
| Local no sincronizado | Conservar documento/cola local exclusivos, mismo ID con hash igual y conflicto con hash diferente. No borrado/overwrite. Pérdida total: unknownTailPossible=true aun con counts/hashes perfectos. |
| Multimoneda/cambio | Fixture 550 DOP, recibido 10 USD a 60, cambio 50 DOP; caja USD +10/DOP -50 antes de fondo. Combinación efectivo/tarjeta/crédito y tasas históricas distintas; no usar tasa vigente ni sumar monedas. |
| Devoluciones/anulaciones | NC parcial/total, devolución wallet/tarjeta, VOID, venta original fuera del conjunto; no doble resta ni doble reintegro; conservar vínculos fiscales. |
| Abonos/anticipos | Varias allocations, deuda de cierre anterior, anticipo sin aplicar, solo abonos sin ventas; preservar recibido/aplicado/no aplicado y demostrar cálculo aprobado de efectivo. No reaplicar saldo. |
| Aislamiento | Dos tenants, empresas y terminales con IDs locales iguales/T1, cursor/snapshot ajeno y takeover a mitad. Sin filas ajenas, sin ampliar alcance por body. |
| Dos fechas | Venta 23:55 y abono 00:10, cierre al día siguiente; varios días sin cierre; reloj atrasado >5min y recepción tardía. Membresía explícita prevalece sobre fechas. |
| Cambio durante descarga | Aplicación/fallo nuevo, venta nueva, cierre y avance fiscal entre páginas. Páginas inmutables; revisión detecta cambios antes de cierre/activación; no mezclar cortes. |
| Series | Contador local mayor/remoto mayor, reserva agotada y números offline desconocidos; no retroceso, número repetido, ni incremento al importar. |
| Payload incompleto | Venta sin items, falta de moneda/cambio, referencia rota y página truncada: no certificar Z exacto aunque coincida el conteo global. |

## 10. Orden de trabajo y criterio para empezar POS

1. Entregar al hilo ERP el prompt adjunto y confirmar contrato, persistencia real, pertenencia legacy, estados, reservas, casos de abonos y fixtures de ejemplo.
2. Cerrar decisiones compartidas: modelo de conjunto abierto, cálculo de efectivo con abonos, estrategia de cobertura desconocida, consistencia/revisión final, retención y compatibilidad del canal LAN.
3. **Avisar al usuario antes de iniciar implementación POS.** Empezar por tipos/validación y staging, luego importación sin efectos y respaldo de brechas; no implementar contra rutas supuestas.
4. Probar en entorno aislado; PRs pequeños. Sin tocar tablet/base cliente, sin deploy/merge de producción como parte de esta fase.

Este diagnóstico y el prompt son la entrega de fase 1. No se afirma restauración operativa disponible hoy.

## Apéndice: consultas reproducibles de auditoría

Consultas realizadas como solo lectura, sin IDs ni payloads individuales de clientes. Para validar una recuperación real, el ERP debe añadir el alcance canónico autorizado; estos agregados globales no lo sustituyen. Ejecutar las consultas de una evaluación de cobertura bajo un único corte consistente y registrar su instante.

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'erp_sync_inbox'
ORDER BY ordinal_position;

SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'erp_sync_inbox';

SELECT event_type, status, count(*) AS rows
FROM public.erp_sync_inbox
GROUP BY event_type, status ORDER BY event_type, status;

SELECT event_type, count(*) AS total,
  count(*) FILTER (WHERE payload ? 'transaction') AS with_transaction,
  count(*) FILTER (WHERE jsonb_typeof(payload#>'{transaction,items}') = 'array'
    AND payload#>'{transaction,items}' <> '[]'::jsonb) AS nonempty_items,
  count(*) FILTER (WHERE payload#>'{transaction,payments}' IS NOT NULL) AS transaction_payments,
  count(*) FILTER (WHERE payload#>>'{transaction,zReportId}' IS NOT NULL) AS transaction_close_id,
  count(*) FILTER (WHERE payload#>'{report,transactionIds}' IS NOT NULL) AS report_transaction_ids,
  count(*) FILTER (WHERE payload#>'{report,collectionIds}' IS NOT NULL) AS report_collection_ids,
  count(*) FILTER (WHERE payload#>'{report,cashMovementDetails}' IS NOT NULL) AS movement_details
FROM public.erp_sync_inbox
WHERE event_type IN ('SALE_POSTED','SALES_CREDIT_NOTE_POSTED','CASH_CLOSE_POSTED','CASH_MOVEMENT_POSTED')
GROUP BY event_type ORDER BY event_type;
```
