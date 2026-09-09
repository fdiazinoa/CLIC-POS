# Fase selectiva: commit → FIRST_RENDER

Solo instrumentación, sin cambios funcionales en App, POS, sincronización o SQLite. El build ya no usa react-dom/profiling ni recorre fibras. El release no parchea dependencias nativas SQLite/Capacitor. Se retiran las llamadas síncronas POSDiagnostics.section del camino JS.

## Ventanas y alcance

Una pulsación de handleKeyPress, handleProductCardClick o handleNodeSelect abre 5 segundos de captura. Las funciones seleccionadas de App, ModernLoginScreen, POSInterface, TableMap, SyncManager.initialize y getCollection/readStoredDocuments/fromStoredDocuments emiten FUNCTION_START/END con parentSpan y línea original en el nombre. Otros callbacks .then/catch/finally/queueMicrotask de esos archivos se instrumentan solo durante la ventana. No se registran argumentos ni contenidos.

El hook de commit emite un registro, sin inspeccionar root.current. FIRST_RENDER sigue siendo doble rAF: confirmar presentación con FrameTimeline.

Las continuaciones usan hooks de Zone solo dentro de los scopes instrumentados. PROMISE_RESUME/JS_PROCESSING_START/END distinguen ejecución de espera. El origen y parentSpan son el sitio instrumentado de programación, no una atribución inventada de código desconocido. MICROTASK_CHAIN agrupa microtasks instrumentadas hasta un MessageChannel task; no prueba que todas las microtasks del navegador estén cubiertas ni que haya pintado. El MessageChannel también añade coste. El perfil V8 es necesario para cubrir huecos entre spans.

Las llamadas síncronas del cuerpo de initialize, handleConfigUpdated, addToCart, getCollection/readStoredDocuments y fromStoredDocuments tienen spans con línea para parse/stringify, mapas, filtros, ordenamientos y auxiliares. Operaciones <1 ms se resumen por sitio con count/total/max; no se presentan como spans individuales ni cadenas completas. No se instrumentan cada fibra o cada iteración de un loop. Las muestras V8 deben localizar loops no cubiertos por un span.

SYNC_CALL_NATIVE_RETURN significa retorno inmediato de nativePromise, NO finalización nativa. CAPACITOR_RETURN significa ejecución del callback JS; la respuesta nativa puede haber ocurrido antes. No hay medición nueva de SQLite ni plugin nativo en esta fase. Para descartarlos exigir evidencia de la traza de sistema, no ausencia de eventos.

## Captura

Tres capturas independientes de 30–45 segundos, con Perfetto/atrace y muestreo V8 a 2 ms: 10 pulsaciones login, 10 selecciones producto, 10 aperturas/cambios de mesa. El usuario ejecuta las operaciones, no el agente. No reutilizar capturas de 10 minutos: confirmar cobertura temporal de cada CPU antes de interpretar scheduling.

ADB debe dirigirse explícitamente a 10.0.0.94:5555. Activar hooks al abrir con pos_diagnostics=true. Solo entonces WebView habilita DevTools. Descubrir el socket webview_devtools_remote del PID correcto en /proc/net/unix, hacer adb forward tcp:PORT localabstract:SOCKET y comprobar que /json corresponde al POS. sample-js.mjs guarda un cpuprofile y ancla JS en v8-clock.json; no ejecuta negocio. Retirar forward al finalizar y reiniciar con hooks false cuando no haya operación pendiente.

## Gate de overhead

NO está validado <5%. Coste de emit y flush no incluye todo Zone, wrappers, muestreo y Perfetto. No usar esas métricas como sustituto de comparación A/B. Comparar la misma carga determinista local en el dispositivo con hooks/muestreo apagados y encendidos, en orden alternado, sin red ni escrituras de negocio, y después validar con las acciones reales. Si el coste adicional excede 5% o hay drops, rechazar la muestra para atribución causal. El benchmark aislado no demuestra overhead de todas las interacciones reales.

## Entrega

Informar función, archivo/línea, duración síncrona vs espera, parent spans, TRACE_ID, muestras V8 y slices Perfetto concordantes. El peso de muestras de CPU no equivale a duración exacta de una función. Si solo se ve un callback envoltorio, causa aún pendiente. No descartar SQLite/red/GC/GPU/sync por falta de datos ni optimizar en esta fase.
