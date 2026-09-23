# CLIC-POS 1.1.426-trapqa — cierre de brechas Venta ↔ Mesas

Fecha: 2026-09-23. Equipo: POS físico `10.0.0.129:5555`. Build candidato firmado, conservando datos (`adb install -r`); **no promovido a release**.

## Decisión

- **Brecha 1 (modalidad): cerrada.** `dialog.showModal()` fue descartado por latencia (Venta→Mesas p95 170.3 ms). La alternativa autorizada, overlay opaco con `role="dialog"`, `aria-modal="true"` y focus trap centralizado, pasó los gates físicos sin `inert` sobre Venta.
- **Brecha 2 (foco scanner): no aplica.** `SCANNER_FOCUS_START/END`, 50 cierres: p50 9.1 ms, p95 13.6 ms, p99/max 16.7 ms. No se modificó el scheduling de foco.
- **Brecha 3 (regresión): parcial.** Navegación, búsqueda, carrito, scroll, cantidad, modificadores, descuento por artículo, Tickets, Cobrar, venta, pago e impresión pasaron. La ruta lógica del scanner pasó; **no había lector HID físico conectado** a este POS, por lo que su prueba real queda pendiente. No declarar apto para piloto hasta validarla.

## Medición final en 129

Dos repeticiones de 50 ciclos por dirección, con `Input.dispatchTouchEvent` de CDP. La marca de entrada→render/interactive proviene de instrumentación `performance.now()` de la app: es una aproximación temporal de presentación/interactividad, no una medición óptica del píxel.

| Serie | Venta→Mesas render p50 / p95 / p99 / max | Mesas→Venta interactive p50 / p95 / p99 / max | Hit testing |
| --- | --- | --- | --- |
| 1 | 86.1 / 96.6 / 99.7 / 99.7 ms | 199.9 / 216.5 / 225.6 / 225.6 ms | 50/50 en cada host |
| 2 (final) | **85.6 / 94.5 / 102.9 / 102.9 ms** | **197.1 / 220.0 / 244.2 / 244.2 ms** | **50/50 en cada host** |

Máximo end-to-end de la muestra final: 244.2 ms; cero operaciones >500 ms. Los límites p95 (150/250 ms) pasan. Como dato complementario, Venta→Mesas next-task interactive p95 180.9 ms y Mesas→Venta prepaint p95 120.5 ms.

Tras reset de gfxinfo: 221/505 frames Android janky (43.76%), p50 30 ms, p95 85 ms, p99 97 ms. El comparativo anterior de virtualización fue 361/720 (50.14%), p95 89 ms, con distinta cantidad/contexto de frames; se informa como referencia, no como A/B estrictamente pareado.

## Modalidad y operación

- Focus trap: 8 Tab + 8 Shift+Tab permanecieron dentro de Mesas; al abrir, foco en Cerrar. Árbol AX: un diálogo accesible llamado “Mesas” y cero tarjetas de Venta expuestas. Venta queda `aria-hidden` mientras el diálogo está abierto; no se aplica `inert` a su subtree. Al cerrar se retira `aria-hidden` y retorna el foco al receptor scanner.
- Scanner lógico: un evento `barcodeScanned` durante Mesas no llegó a Venta; el primer evento tras cerrar produjo exactamente una traza de scan. **HID físico pendiente**, porque `dumpsys input/usb` no muestra lector conectado (solo touchscreen Weida, impresora Sewoo y WLAN Realtek).
- Catálogo: scroll 0/25/50/75/100% con tarjetas visibles hasta el final; búsqueda fuera de viewport encontró 2 resultados Veggie; catálogo restaurado y carrito vacío.
- Mesas: Mesa 2 y Mesa 3 vacías abrieron y cerraron; quedaron libres. Mesa 1 ocupada no se alteró. Cambio efectivo de una venta entre mesas no se ejecutó.
- Venta: Papas fritas RD$125 + ITBIS, cantidad 1→2→1, descuento por artículo 10%: total RD$132.75. Tickets→Venta conservó artículo y descuento. Cobrar abrió y se completó **una venta QA en efectivo RD$132.75**. La app mostró “¡Venta Exitosa!”. La orden de impresión fue aceptada y el usuario confirmó que el ticket **salió físicamente** de la Sewoo.
- Modificadores: Hamburguesa BBQ - Regular, Bacon +RD$60, bebida obligatoria Agua con Gas; producto agregado y total RD$719.80 con ITBIS; carrito descartado sin cobrar.
- Proceso Android PID 10191 permaneció estable; sin `ANR in com.clicpos.app`, `FATAL EXCEPTION` ni cierre forzado en logcat posterior.
- Descuento global perdido tras Tickets es un **bug preexistente separado**: [issue #771](https://github.com/fdiazinoa/CLIC-POS/issues/771). No se mezcló con este fix.

## Gates de build y procedencia

Fuente: rama `fix/pos-table-modal-boundary` desde `develop`; PR [#770](https://github.com/fdiazinoa/CLIC-POS/pull/770). Tests: 117 aprobados, suite operativa 53 aprobados, contrato focalizado 9 aprobados; lint 0 errores (7 warnings preexistentes); Vite y Gradle release exitosos. `dist/index.html` coincide con el asset empaquetado por SHA-256. APK firmado `com.clicpos.app`, versionCode 1426, versionName `1.1.426-trapqa-profile`, 33,398,617 bytes, SHA-256 `618f74018d16e6ec3630035abe15edc8abca008eb109c239292bde7c548cbb95`; certificado SHA-256 `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`. Instalada con datos conservados en emulador y 129; humo en ambos pasó. Artefacto y metadata en `../_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite/android/app/build/outputs/apk/release/` de la máquina de build.

**Gate de promoción no ejecutado ni aprobado.** La única causa concreta que impide declarar *APTO PARA PILOTO* bajo el criterio solicitado es la falta de validación del lector HID físico en 129. Conectar el lector y ejecutar lectura inmediata al cerrar Mesas, verificando cero pérdidas/duplicados, antes de promover.
