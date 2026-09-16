# Diagnóstico de apertura del mapa de mesas (baseline 1.1.389)

Fecha: 2026-09-16  
Base funcional: `origin/develop` en `0ce84f7` (PR #709), APK `1.1.389`  
APK instrumentado: `1.1.391`, mismo código funcional más marcadores de diagnóstico  
Dispositivo: Android por ADB `10.0.0.101:5555`

## Conclusión

La demora reproducida pertenece al árbol del mapa de mesas y tiene dos causas distintas:

1. **Primera apertura:** `fitRestaurantViewport` lee `getBoundingClientRect()` sobre el árbol recién montado y fuerza cálculo síncrono de estilo/layout antes del commit. La función se ejecutó dos veces en la muestra trazada y acumuló `90.2 ms` (`89.5 ms` en una sola llamada). En las 10 primeras aperturas su duración fue p50 `66.4 ms`, p95/p99 `90.2 ms`. Está en `components/TableMap.tsx:650`; la lectura forzada está en la línea 654 y los dos disparadores en las líneas 696-702 y 720-724.
2. **Aperturas calientes:** `TableMap` permanece montado. Al cambiar el host de `invisible` a `visible` y retirar `inert`, Blink recalcula estilo sobre el árbol retenido. No se ejecutaron `TableMap`, `POSInterface`, `ProductGrid` ni sus memos en ninguna de las 20 reaperturas. La activación está en `App.tsx:1951-1983`, especialmente líneas 1954-1963 y 1980-1983.

No se reprodujo el pico de `~900 ms`: el máximo de las 10 primeras aperturas fue `282.8 ms`. Por tanto, esta evidencia no permite atribuir aquel pico a una función concreta. Sí identifica y cuantifica el costo estable reproducible.

## Distribución

Los tiempos son desde la entrada táctil hasta la primera oportunidad visual confirmada por doble `requestAnimationFrame`.

| Escenario | n | p50 | p95 | p99 | min | max |
|---|---:|---:|---:|---:|---:|---:|
| Primera apertura | 10 | 204.9 ms | 282.8 ms | 282.8 ms | 202.2 ms | 282.8 ms |
| Apertura caliente | 20 | 91.4 ms | 106.6 ms | 106.7 ms | 87.6 ms | 106.7 ms |

En caliente, 2 de 20 aperturas superaron 100 ms. Esto no es equivalente a un porcentaje de frames lentos: es una clasificación por apertura completa.

### Primera apertura

| Tramo/actividad | p50 | p95/p99 | Nota |
|---|---:|---:|---|
| Preparación de datos React | 10.5 ms | 12.4 ms | 4 mesas, 1 salón, 2 tickets, 2 cuentas |
| Mount -> commit | 66.6 ms | 90.2 ms | Coincide con `fitRestaurantViewport` |
| `fitRestaurantViewport` | 66.4 ms | 90.2 ms | Lectura geométrica síncrona |
| Commit -> primera visible | 74.9 ms | 122.1 ms | Incluye scheduling de dos frames |
| Script (CDP) | 162.0 ms | 219.1 ms | Métrica acumulada, no aditiva |
| Recalculate Style (CDP) | 106.1 ms | 139.8 ms | Métrica acumulada, no aditiva |
| Layout (CDP) | 7.1 ms | 11.3 ms | Métrica acumulada, no aditiva |

Una primera apertura representativa en Perfetto separó: Style `82.0 ms`, Layout `10.4 ms`, Paint `8.8 ms`, PrePaint `4.2 ms`, Compositing Commit `2.6 ms`. Son eventos anidados/solapados y no deben sumarse ni convertirse en porcentajes del tiempo de pared.

### Aperturas calientes

| Tramo/actividad | p50 | p95 | p99 |
|---|---:|---:|---:|
| Handler | 4.3 ms | 6.0 ms | 6.5 ms |
| Commit de visibilidad | 2.9 ms | 3.7 ms | 3.7 ms |
| Commit -> primera visible | 88.5 ms | 102.9 ms | 103.0 ms |
| Script (CDP) | 40.0 ms | 48.0 ms | 54.2 ms |
| Recalculate Style (CDP) | 52.2 ms | 64.4 ms | 68.9 ms |
| Layout (CDP) | 2.0 ms | 2.6 ms | 3.8 ms |
| Style (Perfetto) | 40.8 ms | 51.9 ms | 53.2 ms |
| Paint (Perfetto) | 6.9 ms | 7.3 ms | 7.7 ms |
| PrePaint (Perfetto) | 3.6 ms | 3.8 ms | 4.3 ms |
| Compositing Commit (Perfetto) | 2.2 ms | 2.4 ms | 2.4 ms |

Las métricas CDP y Perfetto describen eventos solapados; no son una partición aditiva.

## Timeline exacta de la primera muestra

| Marca | Desde touch |
|---|---:|
| `ACTION_START` | 0.0 ms |
| `NAVIGATION_START` | 2.2 ms |
| `DATA_PREPARATION_START` | 21.1 ms |
| `DATA_PREPARATION_END` | 32.0 ms |
| `TABLE_MAP_MOUNT` | 70.5 ms |
| `REACT_COMMIT` | 160.7 ms |
| `TABLE_MAP_EFFECTS` | 171.6 ms |
| `HANDLER_END` | 180.4 ms |
| `TABLE_MAP_FIRST_VISIBLE` | 282.8 ms |

El DOM de esa muestra tuvo 154 nodos, 4 nodos de mesa y 146 elementos visuales.

## Ranking de funciones/componentes en la primera muestra

| Función/componente | Archivo:línea | Llamadas | Total | Máxima |
|---|---|---:|---:|---:|
| `fitRestaurantViewport` | `components/TableMap.tsx:650` | 2 | 90.2 ms | 89.5 ms |
| `TableMap` | `components/TableMap.tsx:500` | 3 | 20.3 ms | 18.9 ms |
| `SmartTableNode` | `components/TableMap.tsx:2515` | 4 | 2.4 ms | 1.8 ms |
| `smartTables` | `components/TableMap.tsx:879` | 1 | 2.2 ms | 2.2 ms |
| `POSInterface` | `components/POSInterface.tsx:1123` | 1 | 1.7 ms | 1.7 ms |
| `safeTables` | `components/TableMap.tsx:585` | 1 | 1.5 ms | 1.5 ms |

Los demás memos medidos estuvieron en `0.7 ms` o menos. `ProductGrid` no apareció. En las 20 reaperturas el mapa, POS y ProductGrid registraron cero ejecuciones: el costo caliente no proviene de renders React repetidos.

## SQLite, Capacitor, red y carga de recursos

El flujo medido entró desde venta directa, sin mesa activa ni carrito. `handleBackToMap` llega directamente a `onOpenTableMap` en `components/POSInterface.tsx:6736-6779`. El cambio de vista ocurre en `App.tsx:11914-11924` sin esperar red ni SQLite. La liberación/reconciliación remota se agenda después mediante `setTimeout` en `App.tsx:11927-11937`.

Por orden causal, esas operaciones posteriores no explican la primera pintura. No se observó carga lazy del mapa ni ejecución de `ProductGrid` durante la reapertura; el recurso contado por CDP no bloqueó el commit y no altera la atribución. Las trazas globales se usaron solo para descartar I/O del camino crítico; se excluyeron de las cifras porque su instrumentación añadía una perturbación medible.

## Cambio mínimo propuesto (no implementado)

1. Primera apertura: sacar `getBoundingClientRect()` del camino crítico. Mantener el tamaño mediante `ResizeObserver` antes de revelar el mapa, sembrar el viewport con esa medida y permitir como máximo una corrección posterior a la primera pintura. Eliminar el segundo ajuste redundante del `requestAnimationFrame` en el mount.
2. Aperturas calientes: revelar el host mediante una propiedad compuesta (por ejemplo `opacity`) conservando `inert`/`pointer-events`, en vez de alternar `visibility` sobre los 154 nodos. Protegerlo con feature flag y comprobar que el contenido oculto no sea enfocable ni accesible.

El criterio de aceptación para una implementación posterior es p95 `<100 ms` en 20 aperturas calientes, sin cambiar sync, SQLite, catálogo ni el manejo de `EMPTY_PRODUCT_PRICES`.

## Reproducción

1. Compilar un APK release firmado desde la rama de diagnóstico y mantener deshabilitados los observadores globales.
2. Activar explícitamente `window.__TABLE_MAP_DIAGNOSTICS__.arm(...)` por CDP.
3. Ejecutar `node scripts/diagnostics/measure-table-map-open.mjs 20 salida.json` con el WebView reenviado al puerto CDP.
4. Para primeras aperturas, reiniciar el proceso antes de cada medición y repetir 10 veces.
5. Capturar Perfetto con las marcas `TABLE-MAP-OPEN-*` y consultar Style, Layout, Paint, PrePaint y Compositing Commit entre `ACTION_START` y `TABLE_MAP_FIRST_VISIBLE`.

El APK `1.1.391` es solo candidato diagnóstico; no está aprobado para promoción.
