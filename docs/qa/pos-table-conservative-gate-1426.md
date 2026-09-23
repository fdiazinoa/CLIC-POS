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

`dumpsys usb` de la 129 solo enumera pantalla táctil Weida, impresora Sewoo y adaptador Wi-Fi Realtek: **no hay lector HID físico conectado**. La prueba física se trasladó al cliente Android `10.0.0.28:5555`, con la misma APK `1.1.426-trapqa-profile` / code 1426 y lector `ZLW HID Keyboard` (vendor `0x2f81`, product `0x7209`). Esto no sustituye las mediciones de latencia de la 129.

### Prueba física controlada en la .28

Con Venta vacía, Mesas abierto como diálogo modal y foco en `Cerrar`, el usuario escaneó una vez sin tocar la pantalla. El observador de `keydown` marcó una ráfaga física de **13 caracteres mientras `aria-modal=true`**. No hubo evento `barcodeScanned`, ni traza `BARCODE_SCAN`, ni artículo agregado al carrito: el código **no se filtró a Venta**. Sin embargo, el sufijo **Enter** del mismo lector llegó con foco en `Cerrar` y **cerró Mesas**. Estado posterior: `aria-modal=false`, foco de nuevo en `Lector de códigos`, carrito vacío. Por tanto falla el requisito de que Mesas permanezca abierto al intentar escanear.

Sin tocar Buscar, el usuario escaneó una vez más en Venta: **una** ráfaga física de 13 caracteres, **un** evento `barcodeScanned`, **una** traza `BARCODE_SCAN` y **un** Agua agregado al carrito (RD$70.80). No hubo pérdida ni duplicación en esta lectura de recuperación. Se descartó ese único artículo sin cobrar ni guardar pedido; carrito final vacío. La primera lectura anterior no se atribuye a Mesas porque el observador la registró con `modal=false`; solo la segunda prueba, armada y verificada previamente con `modal=true` y contadores en cero, sustenta el hallazgo.

**Resultado: gate de navegación de la 129 APROBADO; gate HID físico NO APROBADO por cierre de Mesas provocado por Enter.** La serie obligatoria de 50 ciclos y la sesión operativa completa se detuvieron al primer fallo reproducible; no se reportan como completadas. **PILOTO CLIENTE NO APROBADO.** Mantener [PR #770](https://github.com/fdiazinoa/CLIC-POS/pull/770) en borrador y APK como candidato. Corregir únicamente el manejo del Enter HID cuando Mesas tiene el foco y repetir el gate antes de promover; no abrir nueva investigación gráfica por estas series.
