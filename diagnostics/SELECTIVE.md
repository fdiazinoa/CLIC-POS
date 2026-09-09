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

## Precauciones del análisis de pilas

`resolve-stacks.mjs CAPTURE_DIR ASSETS_DIR` resuelve posiciones de bundle, no garantiza líneas originales: el transform AST devuelve `map:null` y los archivos instrumentados mapean a líneas del código impreso. Usar `npx tsx scripts/diagnostics/inspect-transformed.ts FILE LINE [LINE...]` y localizar luego la función en la fuente original exacta del APK antes de citar una línea. En archivos sin transformación el mapa sigue siendo directo.

El analizador inicial alinea muestras con el punto medio del RPC y publica su incertidumbre. Para ventanas cortas contrastar `Performance.NavigationStart` contra los UserTiming ACTION_START de Perfetto antes de usar esa relación de relojes. Conservar ambas anclas y cualquier delta negativo de V8; los conteos de muestras no son milisegundos exactos.

Un Paint puede ocurrir antes del FIRST_RENDER de doble rAF. No equiparar el marcador a duración percibida ni al primer frame presentado. El nombre de una actualización de estado en PROMISE_RESUME describe el origen de programación: una microtask React de 253 ms con origen setViewport no prueba que el cuerpo del setter dure 253 ms.

## Segunda fase puntual: foco y trabajo de tarjetas

`TARGET_START/END` delimita cuerpos síncronos de foco y funciones seleccionadas que superen 16 ms. También genera UserTiming measures para Perfetto. Máximo 64 intervalos detallados por acción; los contadores continúan al alcanzar ese límite. Los subintervalos de querySelector, querySelectorAll, getClientRects y focus conservan el receptor y la llamada opcional. Sus duraciones son inclusivas; no sumar padres e hijos. El coste interno de DOM focus requiere correlación con Blink/IME/Binder, no se inventa un desglose desde JS.

`TARGET_SUMMARY` agrega por función e intervalo entre commits/flush: count, totalMs, maxMs y umbrales 16/50/100 ms. Incluye ProductGridCard, resolveActiveTariffPrice, productTariffPriceById, checkIsMobile y tres helpers de identidad de almacén. No recorre fibras y no agrega una Promise ni un scope Zone por tarjeta. Estos totales son trabajo ejecutado, incluido trabajo React abandonado; no prueban qué render terminó presentado. El commitEpoch indica el último commit observado, no propiedad causal de un TRACE_ID. Los agregados se etiquetan UNATTRIBUTED para no reasignar llamadas mezcladas a la acción activa al vaciar el buffer.

Para tarjetas se comparan referencias de props por clave de producto; para el memo de tarifas se comparan activeTariffTokens/productPriceIndex/products. Se registran solo nombres y conteos de referencias cambiadas, junto al tamaño máximo del arreglo de productos. No se exportan claves, props ni contenido. La caché retiene como máximo 512 entradas durante el diagnóstico. Una referencia cambiada no prueba por sí sola que el render sea innecesario; la primera observación es baseline. Varias instancias con la misma clave no quedan diferenciadas, por lo que los cambios deben interpretarse dentro de la pantalla/instancia capturada.

`disable()` ahora apaga el registro y evita que otra interacción reactive la ventana. `enable()` vuelve a permitirlo; `arm()` abre la ventana de medición. Zone sigue cargado: una comparación con disable no constituye baseline sin Zone. Antes de aceptar nuevos resultados ejecutar comparación A/B completa con el mismo flujo, build normal frente a diagnóstico, y medir por separado el efecto del muestreo/Perfetto. El benchmark sintético es solo un control incremental, no certifica <5% total. Si falla ese gate, no pedir al usuario repetir una sesión extensa.

## Reducción del coste de continuaciones

La invocación de una microtask conserva su contexto con una pila síncrona separada de los spans de llamadas directas. Su programación captura el padre en taskMeta; no se crea otra Zone por cada continuación. scoped() mantiene el contexto de funciones anidadas. No usar esta pila como condición para activar direct-helper: hacerlo reactivaría getProductPrice durante renders React.

Las microtasks de hasta 16 ms emiten un solo MICROTASK_EXECUTION con startTs/endTs/duration/source, traceId, spanId y parentSpan. Las mayores de 16 ms mantienen PROMISE_RESUME y JS_PROCESSING_START/END, escritos al terminar con sus timestamps originales. Ordenar por timestamps al analizar, no por orden de llegada de los logs. El cambio reduce volumen, no elimina la identificación temporal de continuaciones cortas.

`node scripts/diagnostics/benchmark-observer.mjs RUNTIME.ts OUTPUT.json` compara volumen y coste en el host con 400 callbacks y dos rondas fijas de calentamiento. No es prueba del límite de overhead en Android. Los resultados de la primera revisión fueron 1208 → 406 eventos y 1,45 → 0,79 ms de mediana, sin drops; el orden fijo y el entorno del host impiden extrapolar ese porcentaje al POS.

## Referencia de arranque sin observadores

`pos_diagnostic_control=true` habilita únicamente DevTools en un APK compilado con POS_DIAGNOSTICS. Es independiente de `pos_diagnostics`: con este último false, enabled() devuelve false, no se crean observadores nativos y el bootstrap no carga Zone ni el API JS. En un build ordinario ninguno de los switches habilita DevTools. Esta separación requiere un APK que incluya el cambio; 1.1.335 no lo contiene.

Para cada bloque, reiniciar el proceso entre modos, con el mismo APK, datos y pantalla, fuera de una operación pendiente. Referencia: `pos_diagnostic_control=true`, `pos_diagnostics=false`. Diagnóstico: ambos true. Comprobar cada arranque mediante `check-reference.mjs ENDPOINT reference|diagnostic OUTPUT.json`; abortar si el modo no coincide. disable() en una página que ya cargó Zone nunca sustituye la referencia.

Esta referencia elimina observadores activos y Zone, pero conserva las transformaciones de compilación del APK diagnóstico. No equivale a un release compilado sin instrumentación. Si se requiere overhead respecto a ese release, hace falta comparación adicional con esa compilación; no ocultar esa diferencia ni extrapolar una carga sintética al coste de las acciones reales.

El analizador `analyze-calibration-variance.py CAPTURE --processor TRACE_PROCESSOR_PY` cruza ventanas CAL con unión de spans GC y estados de scheduling de system.ctrace. Requiere ambos marcadores para cada muestra y un reloj común validado. GC y scheduling se solapan: no sumar sus duraciones. El trazado y muestreo de una sesión de localización de variación están activos en todos los bloques, por lo que esa sesión no mide su propio overhead.
