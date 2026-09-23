# CLIC-POS 1.1.426-trapqa — gate conservador Venta ↔ Mesas

Fecha: 2026-09-23. POS físico `10.0.0.129:5555`, versión instalada `1.1.426-trapqa-profile` / code 1426, proceso Android PID 10191 estable. **Sin cambios de código ni APK** durante esta prueba. Estado común: Venta, categoría Todas, búsqueda vacía, carrito vacío, mismo catálogo y hardware. Cada serie tuvo 10 ciclos de calentamiento no contabilizados, seguidos de 50 ciclos medidos por dirección. No se combinaron las muestras entre series.

La medición usa `Input.dispatchTouchEvent` de CDP y marcas `performance.now()` instrumentadas en WebView. Venta→Mesas es el proxy input→fin de render; Mesas→Venta es el proxy input→marca interactiva del siguiente task. No es una medición óptica de píxeles.

## Series independientes (ms: p50 / p95 / p99 / max)

| Serie | Venta→Mesas | Clasificación | Mesas→Venta interactivo | Clasificación | Hit testing |
| --- | --- | --- | --- | --- | --- |
| 1 | 87.0 / 93.4 / 97.1 / 97.1 | VERDE | 201.8 / 224.8 / 243.6 / 243.6 | AMARILLO | 50/50 + 50/50 |
| 2 | 86.6 / 98.0 / 98.9 / 98.9 | VERDE | 199.9 / 215.9 / 249.2 / 249.2 | AMARILLO | 50/50 + 50/50 |
| 3 | 86.4 / 95.8 / 103.3 / 103.3 | VERDE | 201.6 / 218.1 / 219.2 / 219.2 | AMARILLO | 50/50 + 50/50 |

Los tres p95 de apertura son <=120 ms, p99 <=150 ms y máximos <=180 ms. Las tres vueltas cumplen la vía de aceptación alternativa: p95 <=225 ms, p99 <=275 ms, y máximos <=300 ms. Máximo global: 249.2 ms; cero eventos >300 ms. El gate **de estabilidad de navegación pasa**; no se justifica hotfix adicional.

## Estado, modalidad y operación

- Los 150 ciclos medidos completaron hit testing de Mesas y Venta 50/50 por serie; no se observó overlay fantasma ni botón atrapado. Las 30 aperturas/cierres de calentamiento también terminaron sin error.
- Prueba posterior de modalidad: 8 Tab y 8 Shift+Tab permanecieron dentro de Mesas; árbol accesible con diálogo “Mesas” y sin artículos de Venta expuestos; evento lógico de scanner bloqueado en Mesas y exactamente una lectura lógica aceptada tras cerrar. Foco regresó a “Lector de códigos”. `SCANNER_FOCUS_START/END` p95 por serie: 13.7, 13.7 y 15.7 ms.
- El carrito permaneció vacío en las tres series, como exigía el estado común. Una verificación adicional con Papas fritas en venta directa confirmó el comportamiento previo: Mesas no abre mientras hay un ticket directo activo; esa ejecución abortada **no forma parte de las series**. Se descartó ese único artículo QA y se restauró búsqueda vacía/carrito vacío. La conservación de cuentas de mesa, cambio de mesa, cobro e impresión ya pasó en [QA operativo previo](./pos-table-modal-gap-1426.md).
- PID 10191 persistió; logcat acotado sin crash ni ANR del package. No se cambió la APK ni se instaló nada.

## HID y decisión

`dumpsys usb` de la 129 solo enumera pantalla táctil Weida, impresora Sewoo y adaptador Wi-Fi Realtek: **no hay lector HID físico conectado**. Por tanto no se ejecutaron ni se atribuyeron como aprobadas las 50 lecturas reales inmediatas Mesas→Venta, la prueba de no entrada durante Mesas, ni la sesión Venta→lector→artículo→Mesas→lector→Cobrar→pagar→imprimir→nueva venta.

**Resultado: gate de navegación APROBADO; PILOTO CLIENTE NO APROBADO todavía, únicamente por falta de prueba con lector HID físico.** Mantener [PR #770](https://github.com/fdiazinoa/CLIC-POS/pull/770) en borrador y APK como candidato hasta completar ese gate. No optimizar más ni abrir investigación gráfica por estas series.
