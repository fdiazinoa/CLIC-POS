# Diagnóstico: cierre de Mesas hacia POS

Fecha de prueba: 2026-09-14. Flujo medido: botón superior izquierdo `Cerrar` en el mapa de Mesas hasta POS visible e interactivo.

## Causa confirmada

`renderView()` seleccionaba exclusivamente `TABLE_MAP` o `POS`. Al entrar a Mesas React retiraba `POSInterface` del árbol; al cerrar Mesas lo montaba de nuevo. Ese montaje reconstruía la superficie completa de ventas y volvía a activar efectos de montaje, incluyendo la lectura de `productPrices` y el reintento de la cola KDS. La API local de mesas no apareció en `PerformanceResourceTiming` durante los cierres medidos y respondió entre 13 y 35 ms en operaciones observadas, por lo que no explica la pausa de 170 a 353 ms.

No se encontró Redux ni Zustand en este flujo. El estado operativo reside en `AppContent` y se entrega por props. El cambio de vista del padre recreaba además numerosos callbacks inline, por lo que una memoización simple de `POSInterface` no habría sido efectiva.

## Línea base

| Entorno | Resultado |
| --- | --- |
| Emulador Android 11, 2 GB | Cinco cierres: 169.9, 196.4, 232.1, 246.2 y 352.7 ms. Abrir mesa: 217.2 a 329.6 ms. |
| POS físico 1.1.374 | PSS de app: 130.7 a 214.9 MB, mediana 155.4 MB. Memoria del sistema disponible: 5.23 a 5.56 GB. |
| Log físico 1.1.374 | 1,000 tareas largas acumuladas, 114.286 s acumulados y máximo 599 ms durante una sesión de 16 minutos. El formato no atribuye esas tareas al cierre de Mesas. |

Los aproximadamente 460 MB calculados antes sumaban RSS de la app y del proceso WebView. RSS incluye páginas compartidas y puede contarlas dos veces. `dumpsys meminfo` y el bridge nativo muestran PSS real de aproximadamente 130 a 215 MB; el POS físico tampoco estaba en estado de memoria baja.

Los tiempos de checkout de 0.78 a 22.16 s del log incluyen el tiempo del operador entre abrir y confirmar. El commit financiero fue de 65.0 a 81.3 ms; outbox de 2.92 a 6.03 s en segundo plano; impresión de 131.0 a 400.9 ms. Ninguna de esas duraciones demuestra causalidad sobre `Cerrar` sin una traza correlacionada.

## Instrumentación añadida

La operación `CLOSE_TABLE_MAP` registra por separado:

- controlador del clic y acuse visual;
- inicio/fin de navegación;
- inicio/fin del desmontaje de Mesas;
- inicio/fin de actualización del POS retenido;
- primer frame visible y primer frame interactivo;
- tareas JavaScript mayores de 50 ms;
- heap JavaScript al inicio y en ambos frames.

El APK diagnóstico también correlaciona commits React, funciones instrumentadas, sincronización, SQLite/bridge nativo, lecturas de `localStorage` con llave redactada, FrameTimeline y eventos de GC mediante la captura Android/Perfetto. Las capturas acumulativas del seguimiento comercial no se interpretan como costo individual de una tarjeta.

## Cambio aplicado

El POS permanece montado en un host estable y el mapa de Mesas se presenta como una capa. `React.memo` evita actualizar `POSInterface` cuando sus datos no cambiaron; los callbacks se mantienen estables mediante proxies que ejecutan siempre el cierre más reciente. Al ocultar el POS, los cambios reales de carrito, mesa, ticket, productos o sincronización todavía atraviesan la frontera y se renderizan; sólo se omiten renders causados por identidad nueva de callbacks.

No se cambió la lógica de venta, persistencia, locks, cobro ni sincronización. Tampoco se añadió `startTransition` como sustituto del trabajo: el trabajo de remontaje fue eliminado.

## Validación

- TypeScript: correcto.
- Build Vite de producción: correcto.
- Pruebas focalizadas: 37 correctas.
- Gate APK: 117 contratos correctos.
- APK firmado candidato: 1.1.375, `versionCode` 1375, commit `cfe2461`.
- Firma: certificado esperado de CLIC POS.
- Promoción: pendiente de métricas posteriores en emulador y POS físico.

