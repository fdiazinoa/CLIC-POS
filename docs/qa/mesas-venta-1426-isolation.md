# CLIC-POS 1.1.426-profile — aislamiento Mesas ↔ Venta

Estado: diagnóstico, **sin fix de producción**. Mediciones tomadas dentro de WebView con `performance.now()`/User Timing. `FIRST_FRAME_VISIBLE` es un `requestAnimationFrame` previo al paint, **no** una medida óptica del primer píxel. `UI_INTERACTIVE` es una comprobación en tarea posterior, no una garantía de que todo el trabajo del renderer haya terminado. Los percentiles de muestras pequeñas (n=3) son descriptivos, no inferenciales.

## Entorno

| Equipo | Sistema | WebView | GPU | Catálogo elegible |
|---|---|---|---|---:|
| 10.0.0.129 | Android 13 x86_64 (Aptio CRB) | Chromium 129 | Intel HD Graphics BYT | 163 |
| 10.0.0.28 | Android 9 arm64 (M27X) | Chromium 109 | Adreno 506 | 2,187 |

Se instaló una APK firmada **solo QA** `1.1.426-tableqa` (build 1426) con instrumentación y variantes controladas. La APK normal `1.1.426-profile` fue restaurada en ambos equipos con `adb install -r`, sin borrar datos. Las mediciones A–F y de DOM fueron primero en 129; 28 sirvió de contraste limitado. No se cambió Sync, SQLite ni el flujo productivo de mesas.

## Flujo real A: mesa libre, 129 (n=30)

Los valores son milisegundos. Abrir Mesa 2 y regresar; se confirmó que seguía libre.

| Segmento | p50 | p95 | p99 |
|---|---:|---:|---:|
| Touch → lock end | 61.8 | 87.5 | 97.0 |
| Lock start → end | 40.8 | 69.5 | 79.0 |
| Lock end → account end | 8.1 | 10.4 | 15.5 |
| Account end → cart ready | 1.2 | 4.2 | 7.5 |
| Cart ready → view change request | 69.9 | 81.0 | 95.7 |
| View change → React commit end | 280.4 | 296.4 | 298.3 |
| Commit → prepaint rAF | 1.6 | 1.8 | 1.8 |
| rAF → next-task interactive | 197.9 | 626.3 | 664.9 |
| Touch → interactive | 633.3 | 1040.1 | 1088.4 |

Los percentiles de segmentos **no se deben sumar**: corresponden a distintas iteraciones y varios eventos de DevTools se solapan. React commit rápido seguido de rAF también puede preceder trabajo caro de Style/Layout/Paint.

## Flujo real A: mesa ocupada, 129 (n=30)

Mesa 1, una cuenta existente; se midieron por separado el toque que abre el selector y el toque de la cuenta que abre Venta. No había múltiples cuentas para separar ese caso.

| Segmento | p50 | p95 | p99 |
|---|---:|---:|---:|
| Primer touch → lock end | 284.9 | 438.9 | 465.8 |
| Lock start → end | 87.6 | 261.4 | 264.2 |
| Lock end → account end | 0.4 | 0.9 | — |
| Primer touch → selector interactivo | 390.5 | 519.4 | 558.7 |
| Segundo touch → cart ready | 17.8 | 35.6 | 41.5 |
| Cart ready → view change request | 121.3 | 158.1 | 182.5 |
| View change → React commit end | 12.5 | 26.9 | — |
| Commit → prepaint rAF | 2.0 | 296.6 | — |
| rAF → next-task interactive | 461.0 | 633.1 | — |
| Segundo touch → interactivo | 661.4 | 814.7 | 827.9 |

Un guion de cierre de Mesas registró `TABLES_CLOSE_INPUT`, cambio de vista, commit y proxies de frame/interactividad; el foco del escáner no se aisló con percentiles fiables en el mismo lote. No se atribuye tiempo a ese segmento sin evidencia.

## Variantes B–F, 129

| Variante | n | Resultado principal |
|---|---:|---|
| B lock simulado, Mesa 1 | 30 | Lock real sustituido por 0.2 ms p50 / 0.4 ms p95. Selector bajó a 126.2 ms p50, pero cuenta→Venta permaneció 759.6 ms p50 / 1180.9 ms p95. |
| C carrito precargado | 30 | Cuenta→Venta 769.2 ms p50 / 1094.5 ms p95. La variante aún recorrió selector; no es un bypass puro de cuenta y por ello la inferencia es limitada. |
| D `setCurrentView()` puro | 50 | Venta→Mesas 402.5 ms p50 / 459.3 ms p95 / 471.8 ms p99; Mesas→Venta 382.9 / 488.8 / 607.6 ms. Sin lock, cuenta, carrito ni fetch directo. |
| E Venta mínima, Mesas completa | 30 | Venta→Mesas 58.1 / 74.9 / 97.2 ms; Mesas→Venta 61.0 / 75.9 / 80.1 ms (p50/p95/p99). |
| F Mesas mínima, Venta completa | 30 | Venta→Mesas 335.3 / 389.3 / 390.6 ms; Mesas→Venta 328.4 / 557.7 / 560.6 ms (p50/p95/p99). |

La variante D conserva trabajo de fondo normal del proceso aunque el trigger no inicia trabajo funcional. La comparación entre B y C fue secuencial y puede sufrir deriva de carga; no atribuir pequeñas diferencias a la variante.

## Baseline y trazas de renderer, 129

En APK original `1.1.426-profile`, 50 ciclos: Venta→Mesas input→render end 333.0 ms p50 / 345.8 ms p95 / 358.0 ms p99. Mesas→Venta input→prepaint rAF 516.4 / 876.5 / 949.6 ms; input→interactividad proxy 713.1 / 1438.8 / 1467.7 ms. Estos hitos no son idénticos a los de D, así que no constituyen A/B de latencia estrictamente emparejada.

Una traza CDP de Venta→Mesas registró `UpdateLayoutTree` sobre **1,786 elementos** durante 274.8 ms y `Paint` durante 33.9 ms. Una traza Mesas→Venta registró varios `UpdateLayoutTree`: 1,246 elementos/166.8 ms, 146/32.7 ms y 1,786/243.5 ms; `Paint` agregado 4.7 ms. Son muestras individuales, **no p50/p95/p99 de Style, Layout, Paint, Composite o DrawFrames**. Los eventos pueden solaparse y no forman un waterfall aditivo. La solicitud de percentiles por estas fases queda abierta.

## Escala de DOM, mismo 129, trigger D

Catálogo elegible fijo de 163 productos. Resultado Mesas→Venta input→interactividad proxy.

| Tarjetas montadas | n | p50 ms | p95 ms | p99 ms |
|---:|---:|---:|---:|---:|
| 16 | 30 | 193.0 | 228.5 | 255.1 |
| 32 | 30 | 277.5 | 432.2 | 436.8 |
| 64 | 50 | 382.9 | 488.8 | 607.6 |
| 128 | 30 | 674.3 | 741.1 | 745.4 |
| 256 | — | — | — | — |

129 no tiene 256 productos elegibles. La relación monotónica con tarjetas montadas aporta evidencia fuerte de costo DOM/Style en Venta, no una prueba exclusiva de que cada tarjeta sea culpable.

## Contraste en Android nativo 28 y escala de catálogo

Con la APK QA, límite de 100 productos elegibles y **64 tarjetas**, 3 ciclos D dieron Venta→Mesas 1029.7 ms p50 y 1033.4 ms p95; Mesas→Venta 532.9 ms p50 y 1337.6 ms p95. n=3 es insuficiente para un p95 robusto. El proceso respondió a CDP y no se observó ANR en esa comprobación. Esto descarta que el delay exista **solo** en Android emulado, pero no aísla la causa de la diferencia entre equipos (WebView, GPU, CPU, catálogo y versión Android cambian a la vez).

| Productos elegibles | Tarjetas DOM | Mesas→Venta p95 |
|---:|---:|---:|
| 100 | 64 | 1337.6 ms (n=3; no concluyente) |
| 500 | 64 | No medido |
| 1000 | 64 | No medido |
| 2000 | 64 | No medido |

No se completó la escala 100–2000 porque el equipo 28 mostró carga sostenida y la navegación de apenas 3 ciclos tardó ~35 s; seguir con 30 ciclos por tamaño hubiese expuesto el POS a otro ANR. Las marcas `FILTER`, `SORT`, `PRICE_RESOLUTION`, `VISIBLE_PRODUCTS_BUILD` y `CARD_RENDER_COUNT` quedaron instrumentadas, pero **no hay distribución por navegación ni conteo de renders React suficiente para afirmar si los 2,187 productos se reprocesan en cada cambio**. La prueba de 256 tarjetas también queda abierta.

## Respuestas y decisión

1. **Lock remoto:** contribuye al selector, especialmente mesa ocupada, pero no explica la mayor parte del retraso hasta Venta. D sigue lento sin lock.
2. **Carga de cuenta/carrito:** los segmentos reales medidos son pequeños frente a la presentación; C no fue un bypass puro de cuenta, por lo que falta una exclusión definitiva.
3. **Catálogo total con solo 64 tarjetas:** **no determinado**. Falta la escala 100/500/1000/2000 con 64 tarjetas fijas y conteos de filtros/React por navegación.
4. **Tarjetas montadas:** sí hay relación fuerte con la latencia al pasar de 16 a 128 en el mismo equipo; no permite separar todavía React, Style y composición en percentiles.
5. **POSInterface/host de Venta:** es el principal participante observado. Sustituir su contenido por Venta mínima reduce ambas direcciones a ~60 ms p50; minimizar TableMap no.
6. **TableMap:** no parece dominante en este A/B; con Mesas mínima permanece gran parte del retraso.

**No aprobar un fix gráfico todavía.** Lo que está demostrado es que el camino de presentación de Venta/DOM domina la navegación aun sin lock y que el número de tarjetas montadas escala el retraso en 129. No está demostrado que el total del catálogo se procese cada vez, ni hay waterfall p95 por cada fase interna de Chromium. Se conservó el baseline funcional 1.1.426-profile en 129 y 28. La rama y APK diagnósticas no son para release.
