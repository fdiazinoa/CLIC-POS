# CLIC-POS 1.1.426 — Fase 2, host de Venta estable

**Decisión: no aprobar el overlay ni publicar la APK QA.** En el POS físico `10.0.0.129:5555`, dejar Venta visualmente intacta detrás de Mesas redujo el recálculo de Style y la latencia medida, pero la variante rápida no superó la puerta conjunta: Paint al entrar a Mesas empeoró en muestras repetidas y `aria-hidden` no sacó los controles de Venta del orden de tabulación. `inert` corrigió la navegación por teclado, pero devolvió gran parte del trabajo de Style y no alcanzó las metas de latencia. Se revirtió el código funcional de Fase 2; se conserva la virtualización de ProductCards integrada en `develop`. La 129 fue restaurada a `1.1.426-profile` (`versionCode` 1426) con sus datos y con carrito vacío.

## Método y límites

Se compararon el baseline histórico 1.1.426, virtualización sola y tres variantes sobre la **misma 129**: A, overlay sin ocultación accesible; B, overlay + `aria-hidden`; C, overlay + `inert` (C independiente de B). En cada variante se hicieron **50 Venta→Mesas y 50 Mesas→Venta**. Entrada mediante CDP `Input.dispatchTouchEvent`; las marcas `performance.now()` se obtuvieron dentro de WebView. `VISIBLE` es un rAF **previo a Paint**, no el primer píxel comprobado ópticamente; `UI_INTERACTIVE` es un proxy de tarea posterior, no una prueba directa de que el usuario pueda accionar cualquier control. La comparación de renderer procede de trazas puntuales, no de una distribución de 50 trazas. Eventos anidados no deben sumarse. `DrawFrames` no apareció en las trazas CDP; se reporta `gfxinfo` Android por separado.

## Navegación, p50 / p95 / p99 en ms (n=50 por dirección)

| Variante | Venta→Mesas, input→render | Mesas→Venta, input→rAF prepaint | Mesas→Venta, input→interactividad proxy |
|---|---:|---:|---:|
| Baseline 1.1.426-profile, corrida previa | 335.7 / 356.2 / 409.2 | 497.2 / 561.6 / 596.4 | 1016.4 / 1102.5 / 1123.3 |
| Virtualización sola, misma APK QA | 155.1 / 172.7 / 250.6 | 271.5 / 350.7 / 410.9 | 458.1 / 537.5 / 604.8 |
| A — overlay | 84.0 / 97.0 / 99.5 | 109.7 / 140.8 / 143.4 | 161.1 / 198.6 / 219.7 |
| B — overlay + `aria-hidden` | 84.2 / 95.5 / 99.2 | 104.4 / 121.5 / 126.4 | 202.2 / 215.3 / 221.9 |
| C — overlay + `inert` | 177.6 / 187.4 / 198.4 | 195.8 / 210.1 / 214.4 | 283.5 / 297.7 / 303.4 |

El baseline procede del informe de Fase 1 (`pos-catalog-viewport-1426.md`); las otras cuatro variantes se midieron en esta Fase 2 con la misma APK QA. En la zona media del catálogo, ya con 24 tarjetas y 1,050 nodos DOM, una segunda comparación de 50/50 dio: virtualización sola p95 186.3 ms a Mesas, 409.2 ms prepaint y 690.9 ms interactivo al volver; B p95 92.9 ms, 112.3 ms y 229.8 ms respectivamente. No se observó que la diferencia dependiera únicamente de estar al inicio del scroll.

## Renderer, DOM y accesibilidad

En muestras de trazas de la zona media, el máximo de elementos afectados por `UpdateLayoutTree` bajó de **906** con virtualización sola a **157** con B; A mostró el mismo orden de reducción. C volvió a afectar aproximadamente **719–730** elementos. En trazas representativas, `Document::recalcStyle` fue 231.8–412.5 ms con virtualización sola frente a 76.4–93.8 ms con B, según dirección y muestra. La duración de React commit p95 en la primera corrida fue 13.1/221.1 ms (a Mesas/de vuelta) con virtualización sola, 54.5/98.2 ms en A, 54.4/81.5 ms en B y 143.2/72.7 ms en C: el overlay traslada parte del trabajo hacia la entrada a Mesas, pero reduce mucho el regreso.

La puerta de Paint no pasó: cinco trazas Venta→Mesas con ventana extendida después de la marca interactiva dieron `Paint` **[51.8, 36.0, 53.2, 46.4, 39.1] ms** con virtualización sola (mediana 46.4) y **[50.4, 50.1, 55.7, 60.4, 60.7] ms** con B (mediana 55.7, +20%). Mesas→Venta sí mejoró en las trazas comparables, de ~69 a ~19 ms. `TotalAccessibilityCleanLayoutLifecycleStages` tuvo un coste variable de ~39–65 ms con B; no se estableció un percentil de 50 ciclos. `RunTask` y `GPUTask` variaron y se superponen a otras fases; no se interpretan como tiempo adicional acumulable. La captura `gfxinfo` Android de las corridas medias registró 361/720 frames janky (50.1%, p95 89 ms) para virtualización sola y 207/526 (39.4%, p95 85 ms) para B; diferentes cantidades de frames y superficie Android impiden atribuir por sí solas una mejora de WebView Paint.

Con B, `aria-hidden` excluyó de la vista accesible los 14 nodos de “Agua” de Venta mientras Mesas estaba encima (árbol AX de 219 nodos), y el hit test de una tarjeta visible devolvió Mesas, no Venta. Sin embargo, **seis pulsaciones reales de Tab** mediante CDP dejaron `document.activeElement` en `BODY`: los controles ocultos de Venta seguían siendo tabulables y el blur defensivo los expulsaba, sin llegar a Mesas. A expuso los nodos de Venta a accesibilidad. Con C, Tab sí recorrió “Cerrar” y controles del mapa, pero su Style y latencia no pasaron los umbrales de p95 prepaint <200 ms e interactividad <250 ms. Por eso ninguna variante es aceptable aunque B sea la más rápida.

## Regresión operativa y estado del dispositivo

En la APK QA se recorrió scroll 0/25/50/75/100% sin huecos y se alcanzó el último artículo. Hubo 16 tarjetas/874 nodos DOM arriba y 24/1,050 a mitad, con 133 productos elegibles; búsqueda fuera de viewport (`Veggie`), búsqueda `Papas fritas`, categoría Café→Todas y conservación del scroll tras Mesa/volver funcionaron. Se añadió Papas fritas RD$125 + ITBIS RD$22.50, cantidad 1→2→1, descuento por artículo 10% con total RD$132.75, Tickets y Cobrar sin completar pago, Mesa 2 y regreso. Un evento QA `BARCODE_SCAN` con BEB-003 fuera del DOM se procesó en Venta y quedó bloqueado bajo Mesas. No se probó lector HID físico, impresión ni cobro final. No se creó ninguna venta en esta Fase 2.

El **descuento global** de 10% se perdía después de Tickets en la APK QA. Se reprodujo exactamente en el baseline `1.1.426-profile` restaurado: RD$132.75 antes de Tickets y RD$147.50 al regresar. Es una falla preexistente, no una regresión del overlay. El carrito de esa comprobación se descartó; Venta quedó en RD$0.00. No se tocaron Sync, SQLite ni lógica de Mesas.

La APK diagnóstica firmada `1.1.426-hostqa-profile` conservó `versionCode` 1426 y se instaló mediante `adb install -r` sin borrar datos; luego la 129 volvió a `1.1.426-profile` por el mismo mecanismo. La candidata queda solo como evidencia, **no aprobada**. La PR #769 permaneció en borrador, sin merge a `develop` ni publicación. Los cambios funcionales `6c5e9a0` y `59c939a` se revirtieron mediante commits explícitos; solo quedan mejoras de instrumentación e informe en esa rama.
