# Evaluación independiente PERFORMANCE

- Tarea: `sync-command-modifiers`.
- Rol y sessionId: PERFORMANCE, `/root/performance`, independiente de developer/reviewer/QA/sync-validator.
- Base: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Candidato final medido: `70498f5df019d6ea802b4acd6c7a25cc96db405f`; QA funcional independiente PASS comunicado por `/root/qa` vía orchestrator antes de medir.
- Estado: **BLOCKED**. Último estado válido recibido: QA funcional UI PASS (global sujeto a expediente). No es aprobación de performance, código, APK ni release.
- Fuentes: AGENTS.md, WORKFLOW.md, `.codex/agents/performance.md`, `.codex/checklists/performance.md`, `docs/architecture/PERFORMANCE_ARCHITECTURE.md`, `diagnostics/SELECTIVE.md`, analysis.md y plan-review.md.

## Preparación y límites de evidencia

Se creó checkout detached exclusivo de baseline en `/tmp/sync-command-modifiers-perf-baseline`, desde el SHA base exacto. Dependencias se enlazan al node_modules de esta worktree; no se modificó código funcional de ningún checkout. `.perf-modifier-harness/index.html` y `main.tsx` son control sintético copiado del harness QA con imports ajustados al baseline. Se puede servir desde ese checkout con `./node_modules/.bin/vite --host 127.0.0.1 --port 4180` y abrir `http://127.0.0.1:4180/.perf-modifier-harness/index.html`.

El control usa `ModifierModal` real y el adaptador IndexedDB sobre **fake-indexeddb**, con fixture sintético de un producto; no es IndexedDB nativo del browser, POS completo, Caja 4, sincronización real ni SQLite/WebView. El harness QA actual vive en `node_modules/.qa-modifier-harness`, puerto 4179. Su checkout estaba siendo editado, de modo que sus tiempos no serían baseline congelado. No se midió candidato sin QA funcional PASS.

## Matriz requerida para continuar

1. Recibir candidate SHA congelado, review PASS y QA funcional PASS; reconstruir control candidato idéntico al baseline.
2. Mismo host/browser/version, viewport, dataset, flags, red y sync. Capturar separadamente frío, caliente y sync idle/activa/reconnect. El harness aislado no ofrece las últimas condiciones.
3. Medir apertura de opciones, selección de extras y confirmación, más operaciones transversales exigidas por checklist. Capturar input→visible/interactivo sin equiparar commit React o doble rAF con presentación física. Registrar commit, persistencia/sync/proveedor/print por separado.
4. Por operación/modo: >=100 muestras válidas en >=3 sesiones; warmup separado; nearest rank para n/p50/p95/p99/max y delta absoluto/porcentual; conservar muestras/outliers y capturas. Objetivo p95<=50 ms; investigar regresión >5% o >5 ms. Legacy APK 500 ms se informa por separado.
5. Correlacionar Long Tasks, main thread, JSON/storage/GC, layout, renders y stalls con capturas SELECTIVE y relojes/drops/overhead válidos. No certificar overhead total mediante microbenchmark.

## Hipótesis preventiva del diff

La primera versión inspeccionada de `mergeIncomingRestaurantProductConfig` materializa aliases camel y snake de grupos/notas en raíz y restaurant; baseline normalizaba snake en raíz y restaurant. Aunque las referencias en JS se compartan, JSON las serializa por cada propiedad y puede aumentar tamaño/coste de persistencia en adaptadores JSON. Se comunicó a developer/orchestrator para evaluar eliminación de aliases conflictivos (permitida por el plan). Es observación de código sobre un diff no congelado: **no es una regresión temporal medida ni conclusión sobre el candidato final**.

## Bloqueos actuales

En la primera evaluación no había QA funcional PASS del candidato ni baseline/candidate runtime comparable con muestras suficientes; la actualización posterior se documenta abajo. No se tiene evidencia runtime Android/Caja 4 requerida por el plan. No se generó/instaló APK ni se operó datos reales. En esa evaluación inicial n/p50/p95/p99/max, capturas de compositor/WebView y deltas estaban **NO MEDIDOS**, no cero ni PASS. Las medidas exploratorias posteriores no sustituyen las capturas requeridas. El control Chrome puede aportar evidencia exploratoria cuando proceda, pero por sí solo no desbloquea performance global ni release.


## Medición exploratoria posterior a QA, 2026-09-19

Se ejecutó control comparativo en el mismo tab Chrome 152.0.0.0 (UA macOS Intel 10_15_7), viewport 1800×873, DPR 2, Vite desarrollo, mismo fixture/harness/instrumentación, baseline exacto y candidato exacto. Cada bloque hizo 22 pulsaciones confiables del navegador (isTrusted=true) sobre Bacon, alternando seleccionar/desseleccionar. Las dos primeras de cada bloque son warmup; quedan n=20 por versión. Orden baseline→candidate, una sesión por versión, sin alternancia A/B repetida; no constituye diseño para atribución causal.

Se instrumentó únicamente harness temporal con listener click capture, MutationObserver sobre root y doble requestAnimationFrame. Inicio = recepción del click en documento, sin latencia previa hardware/cola de input. Fin DOM = entrega del observer tras mutación React (aproxima DOM actualizado; **no mide exactamente commit React**). Fin frame = segundo callback rAF, **proxy de oportunidad de render, no presentación física ni prueba del primer frame visible/interactivo**. Reloj único performance.now; no anclas Perfetto/V8 ni medición compositor. Se consultó estado visible tras pulsaciones y se capturó screenshot del control en la transcripción de herramientas.

| Métrica (ms) | Versión | n | p50 | p95 | p99 | max |
|---|---|---:|---:|---:|---:|---:|
| click→observer DOM | baseline | 20 | 6.6 | 7.9 | 8.2 | 8.2 |
| click→observer DOM | candidato | 20 | 6.2 | 8.5 | 8.6 | 8.6 |
| click→doble rAF | baseline | 20 | 11.0 | 12.5 | 18.7 | 18.7 |
| click→doble rAF | candidato | 20 | 11.1 | 12.5 | 12.6 | 12.6 |

Nearest-rank, sin retirar outliers después del warmup. Delta p95 DOM = +0.6 ms/+7.6%; cruza umbral porcentual de investigación y no queda confirmado como regresión por este bloque exploratorio. Delta p95 frame proxy = 0 ms/0%. No se declara mejora ni cumplimiento del SLA UI real a partir de estos proxies.

Long Tasks observadas durante ambos bloques: 0. Observer setup medido entre 0 y 0.1 ms (resolución expuesta del reloj); esto **no certifica overhead total <=5%**, no mide overhead de MutationObserver/RAF/longtask/API de automatización ni su efecto sobre scheduling. Se contaron 44 clicks/44 registros; no hay evidencia de drops en ese contador, pero no es auditoría de trace drops. No se instrumentaron fibras, Zone ni profiler SELECTIVE.

Los controles montan componente React real **sin CSS global del POS**, con fake-indexeddb y sin App, catálogo representativo o background sync. Misma limitación en ambas versiones: las medidas solo describen este microcontrol UI y no el flujo completo de normalización/persistencia, POS final, Caja 4 o WebView. Commit/print/proveedor/sync no se midieron aquí. No se midió microbenchmark CPU del normalizador, para no presentar otro dato auxiliar como sustituto de runtime.

Muestras transcritas a 0.1 ms, metadata y warmup: `/tmp/sync-command-modifiers-performance-samples.json`, SHA256 `65bd6f90c04a668fcd75c29452904bcd1f0ddac84b443442b6d2223c4c516d56`. Observaciones flotantes exactas y clocks de cada muestra permanecen en salidas cua de esta sesión. Instrumentación reproducible: `/tmp/sync-command-modifiers-perf-baseline/.perf-modifier-harness/main.tsx` y `node_modules/.perf-modifier-harness/main.tsx` en checkout candidato.

El candidato final elimina aliases camel antiguos en raíz y restaurant; la hipótesis preventiva de duplicación adicional de JSON queda atendida en código, sin atribuirle una mejora temporal medida.

**Estado global final: BLOCKED** por cobertura insuficiente (n<100, <3 sesiones, sin POS completo/estados sync/Android del candidato/capturas compositor/overhead validado). El QA funcional del candidato habilitó esta exploración; la observación del emulador 1.1.405 existente comunicada por orchestrator corresponde a otro artefacto y no valida performance del candidato. No se construyó, instaló ni desplegó APK.
