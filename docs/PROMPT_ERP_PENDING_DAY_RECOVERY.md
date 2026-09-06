# Prompt para el hilo CLIC-ERP — recuperación de jornada POS

Copia el bloque siguiente como instrucción del hilo ERP. El diagnóstico complementario está en `CLIC-POS/docs/POS_PENDING_DAY_RECOVERY_AUDIT.md`; este prompt es autosuficiente para iniciar la validación.

---

Trabaja exclusivamente en **CLIC-ERP**, en una rama nueva basada en **origin/clean-erp**. No modifiques CLIC-POS: se trabajará en otro hilo después de validar el contrato. No hagas push directo, deploy ni cambios en producción.

Necesitamos preparar la recuperación de operaciones pendientes de cierre de una terminal CLIC-POS cuando se daña la tablet o se pierde la base local. Después de revincular **la misma terminal**, el POS debe restaurar los IDs y relaciones originales y poder calcular el mismo cierre Z. Recuperar NO puede volver a aplicar ventas, cobros, inventario, deuda, wallet ni contabilidad.

**La protección contra dos dispositivos con la misma identidad ya existe. Reutiliza autenticación, revinculación, takeover y exclusión del dispositivo sustituido. No rediseñes pairing ni takeover.**

## Fase actual y límites

Primero audita y valida el contrato que sigue. No implementes endpoints a partir de supuestos. No ejecutes ventas/cierres de prueba, reprocess, backfills, UPDATE, DELETE, migraciones ni escrituras en producción. Puedes revisar código, esquema y agregados mediante consultas de solo lectura. Usa fixtures y bases temporales cuando se autorice implementación posterior.

Entrega primero: evidencia de fuentes, diferencias con lo propuesto, contrato final propuesto verificable, brechas, cambios mínimos y ejemplos/fixtures necesarios para el POS. Distingue claramente APIs existentes de nuevas propuestas. No afirmes que hay respaldo completo porque coinciden los conteos conocidos: puede existir una cola que nunca salió de la tablet.

## Evidencia ya observada, que debes confirmar en tu checkout

Referencia previa ERP `origin/clean-erp`: `689ada57f5c5c1d35c327607295892aef40a47db`. POS auditado: `origin/develop`, `5993b1fed18c230dde89734e91fa94e0a95ce2bc`. Confirma tu commit y las diferencias desde esas revisiones; no asumas que producción tiene el mismo código.

1. ERP `server/routes/syncInbox.js`:
   - `deriveTransactionEvents` guarda `payload.transaction` y genera SALE_POSTED o SALES_CREDIT_NOTE_POSTED; PAYMENT_POSTED lleva pagos de liquidación separados. No sumar ambas representaciones como dos cobros.
   - `deriveCashMovementEvents` guarda `payload.movement`; summary usa concept/createdAt, mientras el original POS usa reason/timestamp. El original recibido es la mejor fuente de esos valores.
   - `deriveZReportEvents` guarda `payload.report` y summary; estos no prueban membresía completa por sí solos.
   - `processInboxOnTable`/`mergeInboxPayloadScope` preservan campos del evento existente en duplicados: reenviar mismo eventId no es necesariamente una actualización de la revisión original.
   - Fallback `sync_events` puede marcar APPLIED sin pasar por aplicación comercial. No usar ese estado como prueba de aplicación.
   - `/api/sync/inbox/batch`, `/transactions`, `/cash/movements`, `/z-reports` son recepción. `/api/pos/z-reports` es auditoría ERP, no contrato de recuperación exacta de jornada.
2. `server/services/posEventApplier.js`: deriva `erp_sales_documents`, `erp_sales_document_items` y recibos/asientos. Hay redondeo, resolución de maestro y proyección de líneas; el fallback de líneas pierde detalle. Recibos derivados no equivalen a Collection/allocations originales del POS. Puede existir contabilidad diferida al Z y efectos parciales al fallar.
3. `server/services/posZReportService.js`: relaciona por ventanas y recepción por fechas, con límite de 5000. `applyCashClosePosted` usa también ventanas/candidatos (tope 25000). `accounting_cash_close_event_id` refleja contribución contable, no prueba membresía de todas las operaciones. No reutilices fechas/rangos como sesión exacta.
4. `server/services/posSyncEventOutcome.js` diferencia RECEIVED/STAGED/APPLY_PENDING, PROCESSING, FAILED y APPLIED; DUPLICATE por sí solo no demuestra aplicado.
5. `server/services/posSequenceSync.js` y tablas `erp_document_series`, `erp_fiscal_ranges`, `erp_terminal_fiscal_allocations` representan avance/reservas conocidos. Pueden desconocer números usados offline.
6. `server/services/syncMasterCollections.js` obtiene tables desde businessConfig. Esto no demuestra respaldo de parkedTickets/cuentas abiertas/splits/KDS.
7. Consulta previa de catálogo en proyecto Supabase Clic-Pos `cdfdgxejnbznjxuokrrx`: `erp_sync_inbox` tiene id/event_id UUID, tenant_id/store_id/terminal_id, event_type, payload JSONB, status, last_error, processed_at, created_at; **no company_id como columna**. Hay UNIQUE global event_id y UNIQUE parcial tenant_id/event_id simultáneamente. No cambies estas restricciones como parte de la auditoría; identifica implicaciones para colisiones y versiones.
8. Agregados globales de solo lectura del 2026-09-06: 1262 SALE_POSTED (1224 APPLIED, 38 FAILED), 1227 PAYMENT_POSTED (1179 APPLIED, 48 FAILED), 13 notas APPLIED, 76 cierres (26 APPLIED, 50 RECEIVED), 4 movimientos RECEIVED y 9 wallet RECEIVED. Son evidencia histórica, no conteos de la terminal afectada ni snapshot consistente.
9. Forma del payload: 1262 ventas con transaction/pagos, 1261 con items no vacíos; ninguna venta/NC consultada con transaction.zReportId; ninguno de los 76 Z con report.transactionIds ni report.collectionIds. 42 Z con clave cashMovementDetails. Confirma alias/otros canales antes de generalizar; presencia de clave no prueba contenido.

## Hechos POS que debe satisfacer el ERP

- `App.tsx.handleZReport` utiliza transactions, cashMovements y collections; no limita jornada al día calendario.
- Selectores de ventas: terminal/aliases, sin zReportId y posterior al último closedAt menos 5 minutos. Movimientos: terminal y tolerancia temporal. Modal pasa listas explícitas, pero newZReport no conserva todas esas listas.
- El archivo asigna zReportId/zReportSequence a transactionHistory **después** de enviar el Z; luego retira movimientos/abonos de activos. No hay manifiesto exacto remoto demostrado.
- openedAt se deriva del mínimo de ventas y movimientos, excluye collections. **No se encontró sesión de caja durable**. session_id de diagnóstico/inventario no sirve. Verifica si ERP tiene una sesión operacional real antes de proponerla.
- Pago original: id, method/methodId, amount recibido base, amountOriginal, currencyCode, exchangeRate, appliedAmount, changeAmount, changeCurrencyCode; aliases y settlement* del documento. No usar tasa/catálogo actuales para reconstruir historia.
- Collection: id, displayId, seriesId/seriesNumber, customerId, date, terminalId, method, currencyCode, exchangeRate, receivedAmountOriginal, receivedAmountBase, appliedAmountBase, unappliedAmountBase, totalAmount, allocations[{id,collectionId,transactionId,amount,timestamp}], zReportId/zReportSequence y demás campos originales. No se encontró canal operacional ERP equivalente; verifica antes de concluir ausencia.
- Anticipos de agenda, wallet y abonos CxC son canales diferentes. Cambiar saldo de factura/cliente no respalda recibo ni asignaciones.
- ZDashboard incluye abonos en stats, pero fórmula cashExpected observada suma pagos CASH y movimientos IN/OUT, restando cambio base; no incorpora collections directamente. Documenta esta decisión pendiente con POS: reproducir cálculo original y corregir cálculo son tareas distintas.
- Fondos: configuración fixedCashFundAmount no prueba ingreso real. Preservar movimiento explícito y moneda; no inventar apertura.
- internalSequences y reservas fiscales deben reconciliarse sin bajar contadores ni reutilizar números. Restaurar no consume nuevo número ni emite fiscalmente.
- ZReportRecoveryService local es reconstrucción aproximada; logs de diagnóstico no son respaldo operacional.

## Entrega 1: matriz de cobertura y frontera

Matriz por ventas/líneas/pagos, impuestos/descuentos, devoluciones/NC/anulaciones, entradas/salidas/fondo, abonos/anticipos/asignaciones, Z/membresía, fiscal/series y pedidos abiertos:

`dato requerido → tabla/columna/payload y ruta exacta → cuándo se sincroniza → campos conservados/perdidos por cada transformación → recuperación hoy / cambio necesario`.

Incluye diferencias entre ERP directo, batch y cualquier recepción legacy/LAN relevante. Clasifica evidencia como código, esquema real, forma observada o pendiente. No selecciones arbitrariamente una empresa cliente para extraer documentos personales.

Confirma sesión durable. Si no existe, usa alternativa de **conjunto abierto con pertenencia explícita**, no una supuesta sesión por fechas. Propuesta: nuevos registros con openSetId/versionado persistido, manifiesto Z con IDs+revisiones de ventas/movimientos/abonos y previousCloseId. Legacy sin prueba = membership UNKNOWN. Cruce de medianoche o varios días sin cerrar pertenece al conjunto hasta cierre explícito, no a agrupaciones diarias inventadas.

Z ya recibido con ACK perdido: reconocer ID/eventId original y conservarlo aun RECEIVED/FAILED. No crear segundo cierre ni aplicar de nuevo. Si no se conocen miembros, declarar incertidumbre.

## Entrega 2: validar este contrato HTTP propuesto

Nombres discutibles; no existen por esta tarea:

- `POST /api/sync/recovery/snapshots` con Idempotency-Key, body `{ "contractVersion":1, "scope":"UNCLOSED_OPERATIONS", "includeClosedReferences":true }`.
- `GET /api/sync/recovery/snapshots/:snapshotId`: manifiesto inmutable.
- `GET /api/sync/recovery/snapshots/:snapshotId/records?cursor=...&limit=200`: paginación estable, cursor opaco ligado a snapshot/alcance/versión; límite máximo/bytes acordados, sin truncar silenciosamente.
- `GET /api/sync/recovery/snapshots/:snapshotId/status`: actualización de estados y revisión de pertenencia/cierres/series, separada del snapshot.
- Opcional `POST .../:snapshotId/receipts`: ACK técnico de importación; no altera recepción/aplicación de eventos, no cierra ni borra datos.

Auth: reutilizar token operacional, `resolveAuthorizedTerminal`/`assertCanonicalDeviceAuthorization`, revisión fresca del dispositivo autorizado. Confirma cabeceras X-Sync-Token/X-Device-Id y códigos existentes; no añadir pairing. Tenant/company/store/terminal derivados de autenticación, nunca autoridad del body. Validar cada página; recurso/cursor ajeno no revela datos. Tratar aliases y terminal que cambió de empresa con evidencia histórica explícita o SCOPE_UNRESOLVED.

El manifiesto debe contener:

- contractVersion, snapshotId, cut.revision/capturedAt, expiresAt, scope canónico, ETag.
- boundary.kind/openSetId/previousCloseId/membershipStatus. No inventar sessionId.
- coverage separado: downloadIntegrity, deviceCoverage, membershipCoverage, exactZEligible, knownMissing (IDs o cantidad desconocida), unknownTailPossible, checkpoints/watermarks/huecos y limitaciones.
- counts por tipo y estado; totales por moneda/método, recibido original/base, aplicado, cambio por moneda, entradas/salidas, ventas/devoluciones/descuentos/impuestos, abonos/anticipos/no aplicado. No sumar monedas distintas sin conversión histórica.
- hashes con canonicalización especificada y fixtures de bytes, relación íntegra de IDs/revisiones; hashes prueban la descarga, no la cola perdida.
- series/reservas/máximo usado conocido/next remoto y estado de seguridad.

Cada registro: kind, originalId, originalRevision (UNKNOWN si legacy sin versión demostrable), sourceEventIds, hash, original operacional completo, relaciones de pagos/asignaciones/documento original/cierre, membership OPEN/CLOSED/UNKNOWN, receipt, application y estados por efecto, error/retryable, IDs ERP de conciliación. Preservar IDs fuente; no fabricar revisión histórica. El original no puede ser factura ERP proyectada hacia atrás.

Dependencias de abonos/devoluciones a facturas ya cerradas deben incluirse como referencia read-only fuera del conjunto abierto, o declarar faltante. Pagos embebidos y evento PAYMENT_POSTED no se importan como dos cobros.

Consistencia: created_at<=corte NO basta porque payload/estado cambian. Evalúa materialización transaccional de snapshot o historial versionado; define TTL/retención. Orden fijo y páginas repetibles. Idempotency-Key con mismo body retorna mismo recurso; body distinto 409. Expirado 410 y nueva captura, sin mezcla de páginas. Define cómo detectar cierre/revisión concurrente y validar corte final sin una carrera entre GET status y activación/cierre. Reutiliza exclusión de dispositivo existente.

Estados: recibido ≠ aplicado; DUPLICATE ambiguo = UNKNOWN. Pendiente/fallido se restaura con incidencia visible y sin reenvío automático desde restaurador. APPLIED con contabilidad diferida no implica contabilidad finalizada. FAILED puede tener efectos parciales. El reintento ERP es independiente y conserva identidad original.

Series: max(localNext,remoteNext,usedKnown+1) solo en la misma serie/reserva. Si no se sabe qué números se consumieron offline, no reutilizar bloque perdido; definir avance conservador o bloque nuevo mediante mecanismo vigente. No emitir fiscalmente al restaurar.

Errores: envelope `{error:{code,message,retryable,details},requestId}`; 400 contrato/cursor inválido, 401 auth, 403 revocado/inactivo/alcance, 404 recurso inexistente o ajeno, 409 corte cambiado/ID conflictivo/idempotency key reutilizada/alcance irresuelto, 410 expirado, 422 payload irrecuperable/series inseguras, 429/503 con Retry-After. Partial coverage puede ser 200 con exactZEligible=false; no confundir con error de transporte.

## Entrega 3: cambios mínimos ERP y pruebas, todavía como propuesta

1. Fuente durable y versionada de originales faltantes: Collection/allocations, mutaciones/anulaciones, pertenencia exacta, estados fiscales posteriores. No usar reenvío financiero para refrescar metadata.
2. Manifiesto persistido de cierre y selección por miembros; no completar legado con fechas etiquetadas como exactas.
3. Lectura consistente autenticada y cobertura explícita. **Cero** llamadas a aplicadores, cobros, inventario, deuda/wallet, emisión fiscal o contabilidad durante recuperación.
4. Checkpoint operacional por terminal/época de almacenamiento con secuencia duradera, watermark contiguo y huecos; último checkpoint completo no demuestra que no hubo cola posterior.
5. Retención de originales independiente de logs diagnósticos. No borrar la única copia por ACK de recepción.
6. Sincronización en background fuera del camino crítico del cobro; no requerir red para completar una venta local.

Define pruebas en fixtures/bases aisladas para: Z equivalente con misma declaración/configuración; interrupción/repetición/reinicio sin duplicados; cierre recibido con ACK perdido; eventos pendientes/fallidos/parciales; cola local no sincronizada y pérdida total; varias monedas/cambio/crédito; devoluciones/VOID/abonos/anticipos con allocations; aislamiento empresas/terminales/aliases y takeover durante descarga; cruce de medianoche/varios días sin cerrar/reloj atrasado/recepción tardía; series y reservas desconocidas; corrupción/paginación truncada/cambio de corte concurrente.

Fixture monetario mínimo: venta 550 DOP, recibe 10 USD a 60 y devuelve 50 DOP → efectivo conocido USD +10 y DOP -50 antes de fondo. Incluye otro fixture de solo abonos para descubrir el problema de openedAt y acordar cashExpected. Fixtures son datos en archivos, **no ventas/cierres reales ni simulados en producción**.

## Resultado que necesita el hilo POS antes de implementar

Devuelve contrato revisado (JSON Schema/OpenAPI propuesto, semántica y errores), fuentes exactas, qué está listo hoy y qué debe cambiar, política de legado/coverage UNKNOWN, revisión final/carreras, reservas, ejemplos completos y fixtures con resultados esperados. Indica expresamente qué rutas están implementadas y probadas y cuáles solo propuestas. No marques “listo para POS” mientras alguna decisión crítica dependa de un supuesto.

Espera validación del contrato antes de implementar endpoints. El hilo POS avisará al usuario cuando comience su implementación; este prompt no autoriza tocar el POS ni producción.
