# CLIC-POS 1.1.426 — virtualización del DOM de Venta (experimento)

Estado: **mejora parcial, no aprobada para producción**. Rama funcional `fix/pos-product-viewport-virtualization` desde `origin/develop`; commit funcional `6194ad8`. La APK reversible de QA se construyó desde `a49ad9f` con el mismo `versionCode` 1426 que el baseline. Después de las pruebas, 129 y 28 volvieron a `1.1.426-profile` (1426) sin borrar datos.

La colección filtrada, el índice de códigos, precios, stock, carrito y estado de Venta siguen en memoria. Solo se montan tarjetas de las filas visibles más una fila de overscan arriba y abajo. `ResizeObserver` y el CSS real de la grilla determinan columnas, altura de fila, gap y viewport. La altura total se representa con un spacer; al cambiar categoría o búsqueda se reinicia el scroll, pero ir a Mesas y regresar lo conserva.

## A/B físico, 10.0.0.129, 50 ciclos por dirección

Misma terminal, sesión y método CDP `Input.dispatchTouchEvent`; duraciones tomadas de marcas `performance.now()` dentro de WebView. Los marcadores `RENDER_END`, `FIRST_FRAME_VISIBLE` (rAF previo al paint) y `FIRST_FRAME_INTERACTIVE` (tarea posterior) son **proxies**, no una filmación óptica del primer píxel. Los dos marcadores de Venta→Mesas y Mesas→Venta no representan exactamente el mismo hito y no deben compararse entre direcciones.

| Dirección / métrica | APK | p50 ms | p95 ms | p99 ms | n |
|---|---|---:|---:|---:|---:|
| Venta→Mesas, input→render end | Baseline 1.1.426-profile | 335.7 | 356.2 | 409.2 | 50 |
| Venta→Mesas, input→render end | Virtual QA | 154.6 | 162.9 | 167.6 | 50 |
| Mesas→Venta, input→rAF prepaint | Baseline | 497.2 | 561.6 | 596.4 | 50 |
| Mesas→Venta, input→rAF prepaint | Virtual QA | 271.2 | 353.3 | 354.2 | 50 |
| Mesas→Venta, input→interactividad proxy | Baseline | 1016.4 | 1102.5 | 1123.3 | 50 |
| Mesas→Venta, input→interactividad proxy | Virtual QA | 457.9 | 545.4 | 565.1 | 50 |

Mejora p95: 54% Venta→Mesas, 37% Mesas→Venta prepaint, 51% Mesas→Venta interactividad. **No alcanza** el objetivo inicial de <=150 ms p95 para Mesas→Venta.

Después de restaurar el baseline se repitieron 50/50 ciclos: p95 Venta→Mesas 348.5 ms, Mesas→Venta prepaint 535.4 ms e interactividad 1012.6 ms. La mejora observada no dependió de una sola corrida baseline.

## Renderer, trazas CDP puntuales

Las duraciones de DevTools son de **una navegación por dirección y APK**; no son distribuciones p50/p95. Eventos anidados pueden solaparse y no deben sumarse.

| Evento | Venta→Mesas baseline | Venta→Mesas virtual | Mesas→Venta baseline | Mesas→Venta virtual |
|---|---:|---:|---:|---:|
| `UpdateLayoutTree`, ms agregados | 277.1 | 134.1 | 453.9 | 229.3 |
| Máximo elementos afectados en un `UpdateLayoutTree` | 1,786 | 730 | 1,786 | 730 |
| `Paint`, ms | 31.3 | 25.0 | 4.5 | 4.6 |
| `RunTask`, ms agregados | 481.5 | 174.5 | 476.3 | 220.7 |
| `GPUTask`, ms agregados | 127.4 | 51.7 | 82.3 | 72.2 |
| Input→commit React, ms | 20.1 | 15.4 | 228.0 | 121.6 |

No se obtuvo una distribución fiable de `DrawFrames`, accesibilidad o Style/Paint en 50 ciclos; no se inventan percentiles para esos eventos.

## DOM, scroll y memoria

En 129, Venta con el mismo catálogo pasó de **64 ProductCards / 1,773 nodos DOM** en baseline a **16 ProductCards / 717 nodos** al abrir el candidato. Tras más navegación, permaneció en 16 tarjetas y alrededor de 874 nodos; la diferencia de nodos refleja UI adicional del POS, no crecimiento monotónico de tarjetas. En los puntos 0/25/50/75/100% de scroll hubo entre 13 y 24 tarjetas, sin viewport vacío. Se alcanzó el último producto y al ir Venta→Mesas→Venta se conservaron scroll y artículos visibles. En 50 recorridos top→bottom→top, el heap V8 tras GC pasó de 13,892,508 a 13,559,392 bytes; el DOM acabó con los mismos 884 nodos y 16 tarjetas que al inicio.

Tras 50 ciclos de navegación por APK, el baseline tuvo PSS 166,570 KB, 64 tarjetas y 1,930 nodos; el candidato, PSS 173,481 KB, 16 tarjetas y 874 nodos. El PSS candidato fue **6,911 KB mayor (+4.1%)**, mientras el heap V8 tras GC fue prácticamente igual: 13,648,068 bytes baseline frente a 13,559,392 bytes candidato después del estrés de scroll. Estas muestras no tienen idéntica duración/caché de proceso y no prueban una fuga ni una reducción de PSS. No se observó crecimiento progresivo de heap/DOM en el estrés de scroll.

## Escala en Android nativo 10.0.0.28

Misma APK QA, mismo equipo, 20 ciclos de cambio puro por fila. `productLimit` limita la entrada **solo de QA**; la columna elegibles es lo que pasó el filtro funcional. Cards montadas: 12 en cada navegación; en scroll llegaron a 20, y al final del catálogo completo a 11. `FIRST_FRAME_VISIBLE` es rAF prepaint; `UI_INTERACTIVE`, siguiente tarea.

| Productos entrada QA | Elegibles | Cards al navegar | Mesas→Venta rAF p95 ms | Mesas→Venta interactividad p95 ms |
|---:|---:|---:|---:|---:|
| 100 | 98 | 12 | 311.0 | 573.0 |
| 500 | 472 | 12 | 323.7 | 981.2 |
| 1000 | 937 | 12 | 300.9 | 564.0 |
| 2000 | 1811 | 12 | 311.2 | 1020.8 |
| Catálogo completo | 2187 | 12 | 304.6 | 536.3 |

El p95 prepaint no crece con el catálogo total en esta muestra. La interactividad tiene picos no monotónicos y sigue perceptible. Con 2,187 elegibles se llegó al último artículo; la búsqueda de `Agua` devolvió un resultado aun cuando la tarjeta no estaba montada. No se observó ANR ni crash en las ventanas de logs acotadas del 28.

Tras `performance.clearMarks()` y un ciclo puro Mesas→Venta con catálogo completo, no aparecieron marcas `FILTER`, `SORT`, `PRICE_RESOLUTION` ni `VISIBLE_PRODUCTS_BUILD`: esas fases no se reejecutaron en esa navegación estable. Esta observación no autoriza aún optimizar datos como parte de Fase 1.

## Funciones operativas probadas en 129

| Función | Resultado |
|---|---|
| Scroll 0–100%, sin huecos y último artículo alcanzable | PASS |
| Búsqueda de artículo inicialmente fuera del viewport (`Veggie`) | PASS |
| Búsqueda rápida mediante campo superior (`Papas fritas`) | PASS |
| Cambio de categoría `CAFÉ`→`TODAS`, scroll reiniciado | PASS |
| Ruta de lector `barcodeScanned` con `BEB-003` fuera del DOM | PASS: resolvió producto; agregarlo fue bloqueado por stock 0 |
| Agregar artículo disponible (`Papas fritas`) | PASS |
| Cantidad 1→2→1 | PASS |
| Precio e ITBIS 18% | PASS: RD$125 + RD$22.50; con 2 unidades RD$250 + RD$45 |
| Descuento 10% | PASS: RD$112.50 + RD$20.25, total RD$132.75 |
| Tickets→Venta conserva artículo y descuento | PASS |
| Abrir Cobrar y volver sin finalizar | PASS |
| Venta→Mesas→Venta conserva scroll sin carrito | PASS |
| Eliminar carrito de prueba | PASS; quedó vacío |
| Lector físico HID/USB, modificadores, impresora, pago final y bloqueo fiscal | Pendiente; no simulados como aprobados |

## Decisión

**Mantener únicamente la rama experimental; no mergear ni publicar la APK.** La reducción de DOM produce mejora clara y no mostró regresiones en los casos probados, pero Mesas→Venta aún no llega a <=150 ms p95 y faltan lector físico, modificadores e impresión/pago completos. No se aplicó ninguna optimización de Sync, SQLite, Mesas, locks, precios o lógica de cobro. Ambos dispositivos fueron restaurados al baseline 1.1.426-profile. El APK `1.1.427-profile` generado inicialmente quedó **rechazado sin instalar**: su `versionCode` 1427 impedía reversión segura al 1426 con `adb install -r`.
