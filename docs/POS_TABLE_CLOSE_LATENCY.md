# Diagnóstico: cierre de Mesas hacia POS

Fecha de prueba: 2026-09-14. Flujo medido: botón superior izquierdo `Cerrar` en el mapa de Mesas hasta POS visible e interactivo.

## Causa confirmada

`renderView()` seleccionaba exclusivamente `TABLE_MAP` o `POS`. Al entrar a Mesas React retiraba `POSInterface` del árbol; al cerrar Mesas lo montaba de nuevo. Ese montaje reconstruía la superficie completa de ventas y volvía a activar efectos de montaje, incluyendo la lectura de `productPrices` y el reintento de la cola KDS. La API local de mesas no apareció en `PerformanceResourceTiming` durante los cierres medidos y respondió entre 13 y 35 ms en operaciones observadas, por lo que no explica la pausa de 170 a 353 ms.

No se encontró Redux ni Zustand en este flujo. El estado operativo reside en `AppContent` y se entrega por props. El cambio de vista del padre recreaba además numerosos callbacks inline, por lo que una memoización simple de `POSInterface` no habría sido efectiva.

### Trabajo que hacía el remontaje

| Superficie | Causa del trabajo al regresar | Resultado del cambio |
| --- | --- | --- |
| Catálogo y listado de artículos | Un montaje nuevo reconstruía filtros, deduplicación, códigos de búsqueda, orden y el árbol completo de tarjetas, aun cuando los productos no habían cambiado. | El nodo del catálogo se conservó en 40/40 ciclos posteriores; no hubo render del host POS. |
| Carrito, promociones, impuestos y totales | Los `useMemo` no sobreviven a un desmontaje, por lo que el primer render volvía a calcularlos y a crear sus controles. | Permanecen montados y sólo cambian cuando cambian sus datos. |
| Encabezado y controles | Se reconstruían con `POSInterface`; callbacks inline del padre cambiaban de identidad en cada navegación. | Proxies estables mantienen la frontera memoizada sin capturar closures obsoletos. |
| Credenciales, mesa y ticket | El estado fuente permanecía en `AppContent`, pero la vista consumidora se recreaba y repetía su inicialización. | Se conservan tanto el estado fuente como la instancia consumidora. |
| SQLite, KDS y sincronización | El montaje podía releer `productPrices`, revisar la cola KDS y habilitar efectos de sincronización. | No hubo consulta, recurso de red ni sincronización iniciada por los 40 cierres medidos. Además, los disparadores automáticos nuevos esperan ahora el primer frame interactivo. |

La superficie auditada contiene 39 registros de `useEffect`; los efectos cuyos guards lo permitían volvían a ejecutarse en cada montaje. No se encontró cambio de ruta ni `key` como causa primaria: la exclusión mutua del `switch renderView()` era suficiente para destruir `POSInterface`.

## Línea base

| Entorno | Resultado |
| --- | --- |
| Emulador Android 11, 2 GB | Cinco cierres: 169.9, 196.4, 232.1, 246.2 y 352.7 ms. Abrir mesa: 217.2 a 329.6 ms. |
| POS físico 1.1.374 | PSS de app: 130.7 a 214.9 MB, mediana 155.4 MB. Memoria del sistema disponible: 5.23 a 5.56 GB. |
| Log físico 1.1.374 | 1,000 tareas largas acumuladas, 114.286 s acumulados y máximo 599 ms durante una sesión de 16 minutos. El formato no atribuye esas tareas al cierre de Mesas. |

Los aproximadamente 460 MB calculados antes sumaban RSS de la app y del proceso WebView. RSS incluye páginas compartidas y puede contarlas dos veces. `dumpsys meminfo` y el bridge nativo muestran PSS real de aproximadamente 130 a 215 MB; el POS físico tampoco estaba en estado de memoria baja.

Después del cambio, el emulador reportó 130,093 KiB PSS para la app y 111,040 KiB PSS para el renderer WebView: 241,133 KiB (235.5 MiB) combinados. Sus RSS sumaban 498,820 KiB (487.1 MiB), demostrando por qué sumar RSS infla el consumo por páginas compartidas. No había swap. Se observó un GC explícito de 10.58 ms después de la prueba, no una pausa mayor de 50 ms correlacionada con `Cerrar`.

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

No se cambió la lógica de venta, persistencia, locks, cobro ni los payloads/reintentos de sincronización. Tampoco se añadió `startTransition` como sustituto del trabajo: el trabajo de remontaje fue eliminado.

Como protección adicional, el clic `Cerrar` abre una compuerta de interacción que se libera inmediatamente después de marcar el primer frame interactivo. Mientras está activa, el coordinador ERP, el outbox periódico y el refresco automático de configuración esperan sin perder su solicitud. Un límite de seguridad de 1.5 s evita que un WebView que no entregue el callback detenga la sincronización indefinidamente. La compuerta no cancela una operación que ya estuviera en vuelo; evita que una nueva comience durante la transición.

El primer candidato dejó el cambio de vista dentro de `startTransition`; bajo trabajo continuo del WebView podía quedar pendiente y mantener `Abriendo venta…` en pantalla. El candidato final confirma el cambio pequeño de vista de forma síncrona. También se eliminó una espera de un frame antes del cambio y la sonda de interactividad ya no agrega artificialmente un segundo frame completo.

## Mediciones posteriores

Muestras de 20 ciclos por escenario en el emulador Android 11 de 2 GB. Las duraciones parten del clic programático real sobre `Cerrar` y finalizan cuando el DOM comprometido vuelve al bucle de eventos.

| Escenario | Abrir Mesas p50 / p95 | Cerrar visible p50 / p95 | Cerrar interactivo p50 / p95 | Controlador p95 | Actualización POS p95 | Tareas JS >50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sincronización normal | 12.1 / 16.3 ms | 23.0 / 57.8 ms | 29.9 / 65.6 ms | 0.2 ms | 11.9 ms | 0 |
| Transporte de sync temporalmente offline | 14.3 / 23.1 ms | 37.4 / 89.0 ms | 47.9 / 102.9 ms | 0.7 ms | 18.0 ms | 0 |

En ambos escenarios hubo cero recursos iniciados durante el cierre, cero renders del host POS, desmontaje de Mesas de 0 a 0.1 ms y preservación del mismo nodo DOM del catálogo en 40/40 ciclos. Los identificadores de los siete tickets existentes continuaron siendo únicos; no apareció el ticket temporal eliminado durante la preparación de la prueba.

El primer cierre frío inmediatamente posterior al login tardó 174.4 ms hasta interactivo, aunque el commit de navegación duró 6.0 ms y no hubo tarea JavaScript larga. Los outliers restantes ocurren entre el commit y el frame del emulador. `gfxinfo`, que agrega aperturas, animaciones, cierres y toda la WebView, siguió mostrando p95 global de 150 ms y GPU p95 de 4 ms; no puede atribuir ese total al botón `Cerrar`. La comparación offline tampoco mejoró sistemáticamente el cierre, por lo que la sincronización no es la causa de este flujo.

El objetivo de regreso al POS se cumple en sincronización normal (p50 menor de 50 ms y p95 menor de 100 ms). El acuse visual fue menor de 50 ms en 17/20 ciclos, con p95 57.8 ms: el criterio estricto de menos de 50 ms para todas las muestras todavía no puede declararse cumplido en este emulador. El escenario offline quedó 2.9 ms sobre el límite interactivo p95; no hubo trabajo JS >50 ms que optimizar en ese tramo.

## Validación

- TypeScript: correcto.
- Build Vite de producción: correcto.
- Pruebas focalizadas: 34 correctas, incluidas liberación normal, transiciones superpuestas y límite de seguridad de la compuerta.
- Gate APK: 117 contratos correctos.
- APK firmado candidato: 1.1.377, `versionCode` 1377, commit `7bf7d1d`.
- Firma: certificado esperado de CLIC POS.
- Emulador: actualización con `adb install -r`, datos preservados, smoke test y 40 ciclos correctos.
- POS físico: evidencia base analizada desde el CSV y capturas del cliente; validación posterior pendiente porque `10.0.0.123:5555` devuelve `Network is unreachable`.
- Promoción: pendiente de evidencia posterior en el POS físico; este APK es candidato, no promovido a producción.
