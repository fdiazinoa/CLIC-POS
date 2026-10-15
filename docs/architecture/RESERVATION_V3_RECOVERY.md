# Reservas locales V3: recuperación y liquidación

La recuperación lee `documents.reservations` por ID. La fila del modal o el QR sólo aporta ese ID. Se exige una reserva ACTIVE vigente, cliente/terminal/almacén coherentes y líneas con autoridad V3. Se mantienen los cartId, ERP_ID, cantidades, precios, costos, descuentos, impuestos y epochs originales. El catálogo actual hidrata la caché de validación; no reemplaza las líneas comerciales.

La fuente se reclama en `v3RestoredTicketSources` con ID `reservation:<id>`, JSON original esperado, estado PENDING e identidades estables de factura, eventos y aplicación ADVANCE. Releer/reabrir reutiliza la fuente. La recuperación sólo publica carrito, cliente y abono después de validar y confirmar el claim. `CartItem.v3ReservationId` conserva la referencia local al navegar por configuración; al volver se resuelve nuevamente el claim. No cambia el documento de reserva original.

Las reservas nuevas guardan `v3Snapshot` con totales, descuentos, impuesto incluido, servicio y cliente. Una reserva anterior sin ese encabezado se admite solamente cuando sus líneas históricas permiten reconstruir exactamente el total sin ajustes de encabezado. Fuentes incompletas, expiradas, cambiadas o sin recibos V3 válidos se conservan y se rechazan explícitamente. La reserva recuperada se factura sin editar ni reactivar promociones actuales.

## Commit local

El FinancialCommit existente incorpora en una única transacción SQLite:

- Venta e historia, pagos incluidos y ledger en unidades operativas originales.
- Emisión CAS de secuencia interna/global para esta factura.
- Reserva ACTIVE → INVOICED mediante expectedJSON e ID de factura estable.
- Claim PENDING → SETTLED y único `v3TicketSettlements`.
- Liberación CAS de la cantidad local original en `inventoryCommitments`/su proyección `productStocks`, conservando el resto de otras reservas.
- Cuando sqlite_outbox_v2 ya está ON, los eventos existentes y payment intents pertenecen a ese mismo commit.

ADVANCE es aplicación del anticipo anterior, con ID estable por reserva. Una reserva de 1000 con anticipo 300 solicita 700 nuevos; una completamente abonada no solicita pago nuevo. SALE_POSTED conserva la aplicación anterior. PAYMENT_POSTED, si existe, contiene exclusivamente el nuevo pago, sin cobrar de nuevo el anticipo. No se añade un tipo de evento o contrato ERP.

Con sqlite_outbox_v2 OFF se conserva exactamente el alcance del baseline: commit local atómico y transacción PENDING para el sincronizador operativo existente, sin Outbox artificial ni activar flags. Esto no ofrece garantías nuevas de transporte durable o aplicación exactamente una vez en ERP. No se afirma que un ACK o un test local acrediten aplicación ERP.

Los intentos integrados con el mecanismo de payment intents activo usan identidad estable por reserva/posición. El PaymentEntry aprobado original se reutiliza al reintentar en el mismo modal. Un intento AUTHORIZED recuperado sin el recibo completo del proveedor, AUTHORIZING, UNKNOWN o discrepancias requieren reconciliación; no se reconstruye una aprobación parcial ni se vuelve a cobrar. El CAS de autorización verifica el claim y su reserva vigente en el mismo UPDATE. Con la funcionalidad existente apagada se conserva su comportamiento legacy; esta tarea no despliega ni activa el receptor batch.

## Vencimiento

El temporizador envía sólo las reservas locales estampadas V3 a una operación nativa CAS. La reserva EXPIRED, el claim CANCELLED (o tombstone que exige ausencia) y la liberación del compromiso se guardan juntos. Un perdedor frente a recuperación/facturación no puede sobrescribir una liquidación ni liberar dos veces. El vencimiento legacy permanece igual.

La precondición nativa preserva las fuentes con intentos externos AUTHORIZING/AUTHORIZED/UNKNOWN/RECONCILIATION_REQUIRED. Su resolución requiere el flujo de reconciliación existente; el temporizador no cancela cargos ni borra evidencia. No se generan ventas, pagos o eventos ERP por vencimiento.

## Evidencia y límites

`tests/largeMasterSyncV3ReservationRecovery.test.ts` ejecuta Session/retained sources, builder financiero y adaptador CapacitorSQLite reales sobre SQLite local, con las fronteras de identidad/plataforma/transporte aisladas. Cubre ON/OFF, 300 + 700, prepago completo, revisión de catálogo, cliente/IDs, reapertura, duplicados, conflictos, cada escritura/precommit, respuesta de commit perdida y vencimiento/intent concurrente. Los callbacks reales del modal se ejecutan con la misma fuente durable y cola UI; esto no equivale a una prueba visual Android.

No modifica datos operativos, ERP, flags de formatos ni topologías. La revisión y QA independientes, el dispositivo/WebView y la validación del candidato firmado siguen siendo gates separados.
