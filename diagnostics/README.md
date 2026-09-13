# Fase actual

El profiler masivo descrito abajo quedó retirado. Usar [SELECTIVE.md](SELECTIVE.md) para la fase vigente. Las notas siguientes son históricas y NO autorizan volver a ejecutar el recorrido por fibras.

# Diagnóstico temporal de CLIC-POS

Sin optimizaciones funcionales. Rama basada en develop. Desactivado en builds normales.

## Activación y captura

1. Gate operacional y commit limpio; release canónico con `CLIC_POS_DIAGNOSTICS=true CLIC_POS_RELEASE_LAN_HTTP_ENABLED=true ./scripts/release-android.sh COMMIT`.
2. Instalar APK firmado con `adb -s SERIAL install -r APK` (sin borrar datos).
3. `python3 scripts/diagnostics/capture.py start --serial SERIAL --out DIRECTORIO`.
4. Reiniciar solo la app para habilitar la sesión: `adb -s SERIAL shell am force-stop com.clicpos.app`, luego `adb -s SERIAL shell am start -W -n com.clicpos.app/.MainActivity --ez pos_diagnostics true`. Hacerlo antes del ejercicio, sin operación pendiente.
5. Usuario reproduce al menos 20 acciones; no crear ventas sintéticas automáticamente. Finalizar con `capture.py stop` y mismo destino/directorio.
6. Cerrar la app y abrir con `--ez pos_diagnostics false` para desactivar hooks. El APK diagnóstico conserva el bundle de profiling; volver a un build normal requiere otra versión, nunca downgrade/clear.

## Semántica y límites que no deben ocultarse

- `POS-000001` es correlativo por arranque; `session` distingue arranques. Acciones anidadas comparten ID; operaciones concurrentes mantienen Zone separada. JS async/await se compila a promesas para preservar el contexto. Solo en build diagnóstico. La suite verifica intercalado de dos operaciones, resultados y errores.
- `ACTION_START` = entrada al handler instrumentado; `inputTimestamp` = evento DOM original cuando está disponible. `ACTION_END` = resolución/retorno del handler raíz. Descendientes no esperados pueden continuar con el mismo ID después de ACTION_END; no sumarlos al tiempo percibido.
- `FIRST_RENDER` es oportunidad posterior a paint (doble rAF después de commit React). **No equivale a presentación física medida**. Usar FrameTimeline/UserTiming para corroborar. Si el commit agrupa varias acciones, `ambiguous=true`; no asignar el frame inequívocamente.
- `LOCAL_UNLOCK` registra commit sin estados busy instrumentados; no prueba ausencia de cualquier overlay/bloqueo desconocido. Marcadores legacy explícitos se conservan separados. Cuando falte evidencia de habilitación efectiva, informar duración percibida como no determinada, no inferirla del tiempo HTTP ni del fin del handler.
- Las operaciones JSX (`onClick`, etc.) contienen subspans con nombres de handlers semánticos. Los marcadores existentes agregan IDs de mesa/ticket cuando disponibles. No se registran PINs, datos de pagos/clientes, valores de SQL, cabeceras, cuerpos HTTP ni códigos escaneados.
- Consultas SQL nativas incluyen SELECT con lectura/materialización del cursor, ejecución de INSERT/UPDATE y metadata total_changes/last_insert_rowid. `SQLITE_PREPARE_EXECUTE` es envoltorio y **no se cuenta como query adicional**. Las queries de mantenimiento/drop del plugin no forman parte de esta cobertura; no se ejercitan en la sesión operacional. Hash + template SQL redactado identifican la consulta (template truncado a 700 caracteres). Filas = filas devueltas/materializadas; no páginas ni filas internas examinadas por el motor. `-1`/campo ausente significa desconocido, nunca cero.
- `PLUGIN_START.durationMs` = espera entre enqueue y ejecución. `PLUGIN_START`→`PLUGIN_RESPONSE` y `PLUGIN_RETURN` distinguen trabajo/respuesta nativa. `CAPACITOR_CALL_START`→`END` = viaje completo; no sumarlo nuevamente con SQLite anidado. Plugins callback se registran como streams, no como una única llamada finita.
- `HTTP_HEADERS` termina al recibir headers; cuerpo/parse se mide con spans separados. XHR registra hasta loadend. Imágenes y otros recursos se ven en trazas de Chromium; no se atribuyen automáticamente a una acción. Endpoints opacos; sin querystring.
- React profiling captura componentes renderizados, duración inclusiva, keys de props cambiadas y referencia de estado. Props iguales **no demuestran** render innecesario: pueden cambiar contexto, hooks o hijos. Exigir una cadena de actualización concreta antes de afirmar redundancia. No sumar duraciones inclusivas padre+hijo.
- `longtask` >50ms, Event Timing y Long Animation Frame se activan solo si WebView los soporta. Una capacidad ausente se registra explícitamente.
- FrameMetrics mide cuadros Android >16.7/32/50/100 ms; rAF gaps no equivalen a frames perdidos. El deadline real depende de la frecuencia del panel; FrameTimeline es la fuente de jank del sistema.
- Perfetto: scheduling, Binder, main, RenderThread, renderer, GPU, plugins y dalvik/V8 GC. GC concurrente coincidente no prueba que pausó UI. CPU no es criterio causal.
- La instrumentación añade trabajo. `POS_DIAGNOSTIC_EMIT`, `DIAGNOSTIC_REACT_HOOK`, `DIAGNOSTIC_FLUSH` y `eventOverheadMs` exponen parte del coste; profiling/Zone también pueden alterar tiempos. Identificar eventos dominados por el observador y no atribuirlos al producto.
- El buffer es acotado; revisar drops, eventos incompletos, capacidades y pérdida de paquetes antes de aceptar la sesión. Los datos locales no se publican en el PR.

## Cobertura requerida del ejercicio (marcar lo realmente realizado)

Login; abrir/cambiar mesa; abrir/restaurar ticket; agregar artículo; buscar; escanear; cantidad; cocina; seleccionar pago; cobrar; cerrar ticket; cierre Z; navegación Configuración; Inbox; Outbox; heartbeat; maestros iniciales. Los jobs no ejecutados se declaran sin muestra, no se fuerzan alterando datos.

## Evidencia causal

Un intervalo solapado es un candidato, no una causa. Para asignar SQLite/bridge/red, exigir el mismo trace+span y dependencia que retrasa commit/unlock. Para GC/render, exigir pause/slice en el hilo crítico con scheduling/frame afectado. Si falta ese enlace, clasificar sin explicar. Separar background posterior a respuesta visual. Ranking exclusivo de causas confirmadas y porcentajes con denominador explícito; no repartir tiempo anidado varias veces.

Referencias: https://perfetto.dev/docs/reference/trace-config-proto y https://developer.android.com/topic/performance/tracing/custom-events.

## Hallazgos de compatibilidad en 10.0.0.94 (Android x86)

- `linux.ftrace` de Perfetto confirmó arranque pero entregó cero scheduling slices. Usar `capture.py ... --system-atrace`: preserva otra traza de sistema que Perfetto puede leer. La prueba produjo más de 400.000 slices de scheduling.
- `android.os.Trace` no emitió las secciones personalizadas en este ROM, incluso con APK profileable y filtro de app. **No declararlas capturadas.** Las marcas UserTiming POS sí están en el archivo Perfetto original.
- `analyze.py DIRECTORIO` exporta eventos y operaciones; no declara causas por solapamiento. `annotate.py DIRECTORIO` genera un overlay nativo con START/END medidos y scheduling original. Es una reconstrucción identificada como tal, no un trace section observado del SDK Android. Validar relojes contra UserTiming antes de combinar conclusiones.
- Si la app ya está iniciada, preservar `CLOCK_SYNC` de la misma sesión/PID en `clock-sync.json`; no reutilizarlo tras reiniciar la app o el dispositivo. La sesión de arranque puede guardarse aparte para maestros iniciales.
- En la prueba de arranque, el flush síncrono del recolector llegó a 71 ms; en reposo se observaron muestras menores, pero el coste no es cero. Es un factor de confusión medido. No atribuir al producto frames explicados por el recolector; conservar categoría «instrumentación» y declarar desconocido el efecto no separable. No usar porcentajes causales del producto hasta descartar este efecto.

Para una captura supervisada y acotada usar `record.py --serial SERIAL --out DIRECTORIO --seconds 300` en una sesión exec persistente. Termina por deadline o por `DIRECTORIO/stop.request`, y rechaza una sesión cuyo stream logcat termine. No dejar únicamente `capture.py start` sin un propietario que ejecute stop.

## Recolector 1.1.330

El sink de logs se envía mediante Capacitor de forma asíncrona y se escribe en un hilo dedicado; se excluye de la instrumentación del bridge para evitar autorregistro. En el smoke de arranque se midió flush p95 1.1 ms y máximo 2.6 ms, sin drops reportados. Esto mide solo el flush; no demuestra coste cero del profiler ni es una comparación de rendimiento del producto.
