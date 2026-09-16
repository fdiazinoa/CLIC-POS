# Arquitectura de performance

Fuente POS develop 669f9624c85de40129169e6779aa6983f1441fea, 2026-09-16. Fuentes: utils/interactionPerformance.ts, services/CheckoutPerformanceDiagnostics.ts, CheckoutDiagnostics, utils/startupTrace.ts, services/sync/SyncMetrics.ts, diagnostics/runtime.ts/targeted.ts/viteInstrumentation.ts y diagnostics/SELECTIVE.md.

## Instrumentación observada

Interaction traces contienen input/handler/state/render/SQL/filter/sync/navigation/unlock/first-visible/first-interactive, renderCount, heap opcional y Long Tasks. LOGIN recent code también separa transición visual y procesamiento posterior. CheckoutPerformanceDiagnostics observa longtask y fingerprints seguros de config; SyncMetrics persiste contadores/edades/timestamps. Runtime diagnóstico observa longtask/long-animation-frame cuando la plataforma lo soporta. No se encontraron baselines nuevas p50/p95/p99 por cada acción del negocio en esta instalación.

Vite CLIC_POS_DIAGNOSTICS habilita instrumentación selectiva/sourcemaps/transformación async; MainActivity usa POS_DIAGNOSTICS para bridges/DevTools. SELECTIVE es vigente: no renderer profiling ni recorrido masivo de fibers. Zone y MessageChannel/observadores añaden coste; disable no convierte bundle diagnostic en release normal. FIRST_RENDER por doble rAF no prueba presentación física: correlacionar FrameTimeline/Perfetto. V8 sample identifica stacks, no tiempo exacto de cada función. Clocks/drops/categorías/capturas control se registran.

## Medición y objetivos

Baseline/candidate iguales hardware, Android/WebView/browser, datos, rol, config/flags/red y sync. Medir apertura POS, catálogo, add artículo, abrir/cerrar Mesas, mover mesa, abrir/cerrar Tickets, cobro y navegación pertinentes. Definir input→visible/interactivo y medir duración de commit/print/proveedor/sync por separado; no excluir un bloqueo de red/almacén del indicador de UI.

Objetivo general p95<=50 ms respuesta interactiva. Reportar n/p50/p95/p99/max y delta absoluto/% con nearest rank, sesiones/warmup/frío-caliente y capturas. Golden qa/baselines/apk-1.1.363.json permite navigation p95 500 ms: mantenerlo como presupuesto legacy adicional, no evidencia de cumplir 50 ms. Sin suficientes muestras/entorno = BLOCKED para gate, no PASS inventado.

## Riesgos y diagnóstico

App/POSInterface grandes con shared state, remount/table transitions/lifecycle; JSON/localStorage heavy collections y métricas; inventario recursivo/ledger; sync background/poll/heartbeat; renderer/teclado/bridges WebView. Detectar Long Tasks >50ms, forced synchronous layout y getBoundingClientRect crítico, renders/props/reconstrucción inútiles, main-thread trabajo síncrono/storage/red, GC, pausas/timers periódicos y stalls. Source review aporta hipótesis; captura confirma atribución.

Nunca loaders artificiales/timers arbitrarios/quitar funcionalidad/apagar sync/ocultar componentes sin quitar trabajo/manipular muestras. Mejora performance exige QA funcional y sync cuando aplican. Herramientas existentes: capture.py, analyze-selective.py, sample-js.mjs, check-reference.mjs, benchmark-observer.mjs; ver WORKFLOW comandos y prerequisitos. Esta ejecución solo valida documentación/tooling, no cumple un gate de performance real del POS.
