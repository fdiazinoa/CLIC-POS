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
- Contexto seguro al activar: modelo/versión Android y WebView, ABI, memoria asignable, pantalla, conectividad, almacenamiento del origen y resumen de configuración POS con hash. El resumen usa contadores y opciones operativas explícitas; no copia la configuración completa ni credenciales.
- Muestras en hitos del checkout: PSS/heap Java y nativo, heap JavaScript cuando WebView lo expone, tiempo y porcentaje aproximado de CPU del proceso entre muestras, memoria disponible del sistema, espacio de almacenamiento, batería, ahorro de energía y estado térmico.
- Respuesta percibida: tareas largas del hilo principal y, cuando existe una traza de interacción, tiempos de handler/render/SQL/sync, renders y asignaciones aproximadas.
- Duraciones correlacionadas: apertura a confirmación, confirmación a resultado, commit financiero, ida y vuelta de outbox y aceptación del pipeline de impresión.

Se copian únicamente IDs, nombre de artículo, cantidades e importes (máximo 100 renglones y 20 pagos por registro). No se copian imágenes, catálogo, cliente, PAN/CVV, autorización, tokens ni secretos. Los totales/contadores completos se conservan aunque se trunque el detalle de una cuenta extensa.

Un vaciado de carrito durante el cobro antes del commit, o un documento/evento sin renglones, fija una ventana de hasta 40 registros previos. Se conservan las últimas 10 ventanas de anomalía.

## Rendimiento y persistencia

- Desactivado: salida inmediata; ninguna proyección, escritura, timer o llamada de red por registro.
- Activado: búfer en memoria; no hay await de diagnóstico en ventas, pagos, SQLite financiero ni impresión.
- Las métricas se capturan solo en hitos; no existe sondeo continuo de CPU/memoria. El observador de tareas largas funciona por eventos y se desconecta al desactivar.
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

Benchmark reproducible: `npx tsx scripts/benchmark-checkout-diagnostics.ts`. En la validación local, p95 por registro estuvo entre 0.0032 y 0.0071 ms para 1 a 1000 renglones (detalle limitado a 100). Un millón de llamadas desactivadas tomó 2.349 ms. Son mediciones locales de CPU, no una garantía para el dispositivo del cliente.

## Verificación

Las 26 pruebas enfocadas de logger, entrega, evidencia, rendimiento y latencia pasan. La suite completa aprobó 910 de 926 pruebas; conserva 10 fallos de contrato ya presentes en `develop`. Build TypeScript/Vite, sincronización Capacitor y compilación Java Android correctos. Lint no puede arrancar porque falta eslint.config.* en el repositorio base.

Prueba en emulador autorizada: actualización conservando datos; activar/desactivar; registrar eventos sintéticos marcados; verificar persistencia tras reinicio y exportación; medir CPU en el WebView. No crear ventas/pagos/cierres contables para esta comprobación.

## Precisión de evidencia desde 1.1.296

- `details.operating_mode` indica RETAIL o RESTAURANT cuando el POS conoce el modo operativo. `captured_apk_version`/`captured_apk_code` indican la versión leída del puente nativo durante ese arranque. Los registros antiguos sin ese contexto permanecen desconocidos; nunca se les asigna la versión nueva. La versión de apertura de sesión no cambia.
- Totales ausentes se omiten en el HTTP para que el ERP preserve null; cero real sigue siendo cero. El mensaje muestra «No registrado». Los ceros históricos ya almacenados no se reinterpretan.
- `details.environment` aparece en el evento de activación y en metadata de la sesión. `details.performance` aparece únicamente en los hitos medidos. GPU no se presenta como porcentaje: WebView no ofrece una lectura portable y fiable; se usan tareas largas y tiempos de render como evidencia de fluidez.
- Solicitudes de confirmación usan CHECKOUT_OPENED con mensaje de fase; PAYMENT_CONFIRMED se reserva al resultado del checkout. `details.phase` y `source_stage` conservan el punto exacto. Transacción construida y persistida se distinguen.
- PRINT_DELIVERY_PLAN explica si el comprobante espera el botón manual, irá por correo, impresión automática del procesador o flujo de abono. No equivale a impresión.
- El wrapper compartido observa ticket, precuenta y comanda y devuelve exactamente la misma promesa. Su aceptación nunca acredita salida de papel.
