# Seguimiento de checkout — APK de diagnóstico

Este cambio registra evidencia. No congela/reconstruye carritos, no cambia los validadores existentes, no reenvía ventas ni modifica el flujo de checkout. La corrección preventiva investigada permanece fuera de esta rama.

## Operación

Configuración → Activar log de seguimiento. Requiere el permiso existente SETTINGS_ACCESS. Desactivado por defecto. Cada activación crea un UUID y vence a las 24 horas; la activación se conserva al reiniciar el APK. Se registra la versión reportada por Android al activar y la identidad del dispositivo actual.

La pantalla permite exportar un JSON. En Android queda en Documents/CLIC-POS; en web se descarga. Desde 1.1.295 se envía al canal `/api/sync/diagnostics/sessions` y sus eventos. Usa identidad y credenciales vigentes de la terminal, sin modificar el inbox financiero. El ERP muestra las sesiones en Auditoría → Seguimiento POS.

## Evidencia

- Apertura y confirmación del cobro, valores vistos por PaymentModal y POSInterface.
- Cambios del carrito; solicitudes de limpieza con identificador de origen APP_CLEAR_XX/POS_CLEAR_XX, localizables por búsqueda en el commit del APK.
- Hidratación de mesas: pedido ausente/sin orden/reemplazo, IDs de mesa y pedido.
- Entrada y resultado de creación de transacción; persistencia heredada.
- Construcción del payload y commit durable: transactionId, displayId, eventId, aggregateId y contadores.
- Envío/resultado de la outbox.
- Solicitud y resultado de impresión. ACCEPTED_BY_PRINT_PIPELINE **no acredita que salió papel**; solo que la API de impresión aceptó la tarea.

Se copian únicamente IDs, nombre de artículo, cantidades e importes (máximo 100 renglones y 20 pagos por registro). No se copian imágenes, catálogo, cliente, PAN/CVV, autorización, tokens ni secretos. Los totales/contadores completos se conservan aunque se trunque el detalle de una cuenta extensa.

Un vaciado de carrito durante el cobro antes del commit, o un documento/evento sin renglones, fija una ventana de hasta 40 registros previos. Se conservan las últimas 10 ventanas de anomalía.

## Rendimiento y persistencia

- Desactivado: salida inmediata; ninguna proyección, escritura, timer o llamada de red por registro.
- Activado: búfer en memoria; no hay await de diagnóstico en ventas, pagos, SQLite financiero ni impresión.
- Escritura diferida al menos 5 segundos y en tiempo ocioso a **IndexedDB separado**, clic_pos_checkout_diagnostics_v1. No usa SQLite operacional.
- Memoria: 128 registros recientes, hasta 256 pendientes y 10 incidentes. Disco: hasta 1000 registros recientes y 10 incidentes.
- Fallos de proyección/almacenamiento no se propagan a ventas. Si falla persistencia, la cola pendiente sigue acotada; se reintenta ante actividad posterior.
- Un cierre forzado/corte de energía puede perder el tramo aún en memoria. El diagnóstico no introduce escritura síncrona para evitar esa ventana.
- Envío automático diferido: lotes de 25 cada 10 segundos, timeout de 8 segundos, sin esperar la red desde el cobro.
- IndexedDB v2 conserva la bitácora v1 y agrega cola separada con secuencia autoincremental persistente. Importa una vez logs v1 de sesiones no vencidas con identidad completa.
- Cola máxima: 500 eventos, cada uno menor de 8 KiB, con máximo 50 líneas y recorte por bytes. Descarta INFO antiguos antes de WARN cuando alcanza el límite. El log local sigue disponible para exportar.
- Los ACK eliminan solo eventos confirmados y persisten el estado de sesión en la misma transacción. IDs y secuencias sobreviven a reinicio; no se cambia la identidad original si la terminal se vuelve a vincular.
- Reintenta fallos de red, 429 y 5xx con espera exponencial y jitter. Los rechazos permanentes quedan retenidos para revisión/exportación, sin bucle de envíos. Una sesión vencida no se reabre automáticamente.
- Desactivar detiene captura; los registros ya pendientes completan su entrega. Configuración muestra pendientes, último ACK y códigos de error.
- Contrato ERP: `CLIC-ERP/docs/pos-diagnostic-tracking-api.md`, PR ERP #1997. Etapas POS se traducen al vocabulario ERP y el nombre original queda en details.source_stage.
- Validación previa del ERP: sesión sintética c1d22e61-aa09-498a-8165-ad6e10dd23d6, dos registros/una alerta visibles; deduplicación y rechazos verificados. Esa prueba fue manual, no acredita por sí sola el transporte automático de este cambio.

Benchmark reproducible: `npx tsx scripts/benchmark-checkout-diagnostics.ts`. En Node local, p95 por registro: 1 renglón 0.0018 ms; 20 renglones 0.0024 ms; 100 renglones 0.0035 ms; 1000 renglones (detalle limitado a 100) 0.0085 ms. Un millón de llamadas desactivadas: 1.727 ms. Son mediciones locales de CPU, no una garantía para el dispositivo del cliente.

## Verificación

98 pruebas: logger, matriz Android obligatoria, contrato SALE_POSTED, persistencia/outbox y latencia existente. npm ci y build TypeScript/Vite correctos. Lint no puede arrancar porque falta eslint.config.* en el repositorio base.

Prueba en emulador autorizada: actualización conservando datos; activar/desactivar; registrar eventos sintéticos marcados; verificar persistencia tras reinicio y exportación; medir CPU en el WebView. No crear ventas/pagos/cierres contables para esta comprobación.
