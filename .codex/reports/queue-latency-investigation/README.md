# Investigación de lentitud con transacciones en cola

Fecha: 2026-09-19

Task ID: `queue-latency-20260919`

Base analizada: `8cf4a2a510f4a66e095d60d6246dd4e61a95aafd` (`develop`)

Versión reportada por el cliente: CLIC-POS 1.1.405

Versión del emulador: CLIC-POS 1.1.407 (1407)

Decisión: **CAUSA NO REPRODUCIDA — NO MODIFICAR BASELINE**

Las rutas de sincronización, flags, SQLite y Realtime revisadas no cambiaron entre el commit de 1.1.405
(`64bbdf8`) y la base actual. `POSInterface.tsx` solo recibió un ajuste ajeno al indicador y a la búsqueda:
dependencias de un efecto de rangos fiscales.

## Resultado

No hay evidencia suficiente para atribuir la lentitud a Supabase ni para justificar un hotfix.
La ruta que envía las transacciones pendientes usa el sincronizador operacional hacia el destino que
resuelve el perfil activo: ERP, master o staging. No se capturó el perfil runtime del cliente, por lo que
no puede afirmarse cuál estaba activo durante el episodio. El Realtime privado de Supabase está apagado
por defecto, aunque admite override; polling, hints y heartbeat sí pueden coexistir, pero no se observó
evidencia que los vincule con el retraso reportado.

Según el reporte operativo, el síntoma no se ha podido reproducir en tres entornos independientes:
laboratorio, pareja master-cliente y emulador. Este expediente contiene la evidencia cruda del emulador;
las ejecuciones de laboratorio y master-cliente fueron informadas por el usuario. Hasta ahora el síntoma
solo se ha observado en el equipo físico del cliente.

En el emulador, la búsqueda de catálogo mantuvo el mismo orden de latencia con cero transacciones y
con tres transacciones pendientes mientras el POS pausaba la sincronización por actividad del operador.
La sola presencia de `Online · 3` no reprodujo la lentitud.

Según el usuario, el equipo del cliente fue fabricado para Windows y convertido a Android, igual que los
equipos master-cliente usados con éxito en laboratorio. Bajo ese reporte operativo, la conversión no
explica por sí sola la lentitud. Sí quedan por comparar diferencias de esa unidad: almacenamiento,
WebView, controladores, temperatura, memoria, configuración y estado local. Que el cliente operara
normalmente durante el día y reportara la lentitud de noche refuerza una causa acumulativa o
intermitente, no un costo fijo de la interfaz.

## Perfil conocido del equipo afectado

El usuario aportó una ficha histórica del mismo equipo para describir su configuración. Se toman como
referencia de hardware los siguientes datos:

| Propiedad | Valor informado |
|---|---|
| Placa/fabricante | Intel Corporation `MAHOBAY` |
| Arquitectura | x86_64, 4 núcleos |
| Memoria | 7.65 GB; ficha muestra 192 MB / 512 MB como asignación/límite de la app |
| Pantalla | 1366 × 742 px, 128 dpi |
| Sistema | Android 13, API 33 |
| Conectividad | En línea por 4G, ahorro de datos desactivado |
| Capacidad mostrada | 39.93 GB; la ficha no permite inferir latencia ni salud del almacenamiento |
| Operación | `STANDARD_POS`, modo `offline optimistic`, stock activo, cero impresoras registradas |

La ficha fue generada cuando el equipo aún mostraba APK 1.1.374. El usuario confirmó que actualmente
ejecuta 1.1.405. Por ello, el WebView 129 y los datos de APK/vigencia de la imagen no se usan como estado
runtime del incidente y deben capturarse nuevamente. La RAM y los cuatro núcleos no sugieren por sí solos
escasez de capacidad; red 4G, almacenamiento, temperatura y la capa Android x86 requieren comparación
directa con uno de los equipos master-cliente que funciona bien.

## Medición en emulador

Se midió desde el despacho de `input` hasta dos `requestAnimationFrame`, alternando búsquedas `fr` y
`fra` en la aplicación instalada.

| Escenario | n | p50 | p95 | p99 | máximo | Estado de cola |
|---|---:|---:|---:|---:|---:|---|
| 0 pendientes | 100 | 33.30 ms | 34.30 ms | 34.40 ms | 50.40 ms | sin cola |
| 3 pendientes, sincronización pausada por entrada | 100 | 33.30 ms | 34.50 ms | 34.50 ms | 34.90 ms | 3 `PENDING` |

El usuario ejecutó además una prueba operativa cualitativa: desconectó internet, generó 20
transacciones, continuó facturando sin percibir lentitud y reactivó internet. Reportó que la aplicación
las envió sin dificultad. Esta observación cubre mejor la experiencia durante acumulación y retorno de
red, pero no conserva tiempos ni ACK individuales.

Una lectura posterior de solo lectura encontró 10 documentos `PENDING`, sin `syncError` ni
`_forceSyncReplay`, actualizados entre `2026-09-20T02:56:43.587Z` y `03:00:00.000Z`. En esa captura la
aplicación estaba online, pero la vista activa no mostraba el indicador de sincronización. No es posible
demostrar si esos diez pertenecen al grupo reportado, a operaciones posteriores o a una sesión cuyo
worker ya no estaba activo. Por ello, la prueba confirma ausencia de lentitud percibida en el emulador,
pero no certifica desde la persistencia que las veinte recibieran ACK.

Una captura V8 separada de 15.192 s en reposo produjo 2,661 muestras, 99.66% en reposo. Esa captura
describe únicamente el reposo del emulador y no demuestra el comportamiento del equipo físico durante
sincronización activa. El expediente conserva los percentiles agregados de entrada, pero no las 200
muestras individuales; por tanto, esos percentiles no pueden recalcularse desde los artefactos guardados.

Evidencia cruda conservada:

- `idle-javascript.cpuprofile` — SHA-256 `91a7011cebdf709d75f7a8812eac31e861db6d66ebebef415d7cbe5315ef5b67`
- `idle-v8-clock.json` — SHA-256 `a406fe984e9a15111e00e94f42f934de88642d61e951b216d0e8f126b8022392`
- `emulator-measurements.json` — resumen estructurado de escenarios y limpieza

## Qué representa `Online · 3`

El contador es agregado. Incluye elementos operacionales de varias colecciones, recibos de transferencia
y rangos de numeración pendientes. No significa necesariamente “tres transacciones” ni confirma que el
HTTP al ERP esté activo en ese instante.

La entrada del operador marca el POS como activo durante 5 segundos. El sincronizador evita iniciar o
continúa pausado durante ese intervalo. Por tanto, una fotografía con texto escrito y `Online · 3` puede
mostrar una cola existente mientras su procesamiento está deliberadamente suspendido.

## Qué representa `Online` en amarillo sin contador

La fotografía posterior al soporte muestra `Online` en amarillo y sin número. En 1.1.405 esa combinación
tiene una interpretación exacta: `navigator.onLine=true`, `pendingCount=0`, `blockedCount=0` y
`hasError=true`. No prueba que la sincronización siga activa ni que haya terminado.

El flujo permite conservar ese amarillo como estado residual:

1. El evento offline fija `BackgroundSyncManager.hasError=true`.
2. El botón **Sincronizar Todo** de Configuración solicita reconciliación/manifiesto y catálogos mediante
   `syncTriggerCoordinator` y `SyncManager`; no limpia directamente el estado de
   `BackgroundSyncManager`.
3. Al volver la red, el worker operacional intenta arrancar, pero puede retornar antes de poner
   `hasError=false` si detecta actividad del POS.
4. La cabecera muestra el texto a partir de los contadores y el color también a partir de `hasError`;
   por eso puede resultar `Online` amarillo sin contador.

La lógica relevante del indicador y del flujo manual no cambió entre el commit de 1.1.405 (`64bbdf8`)
y la base analizada. `SyncSettings.tsx` y `BackgroundSyncManager.ts` son idénticos; `POSInterface.tsx`
solo difiere en dependencias fiscales ajenas a este indicador. Esto confirma la semántica visual, pero
no demuestra que el error residual bloquee el hilo o cause la lentitud.

El botón manual sí puede iniciar trabajo de configuración y catálogo. Una degradación que ocurra solo
durante ese trabajo debe medirse como operación separada; el color amarillo que permanece después no
prueba que ese trabajo continúe.

El usuario aclaró que el sistema estaba lento antes de la intervención y volvió a responder con fluidez
después de que soporte ejecutara **Sincronizar Todo** y observara el envío. Esta recuperación temporal es
evidencia relevante de asociación con el estado de sincronización del cliente. Reduce el peso de una
limitación permanente de hardware o de un caché estático, pero no identifica todavía qué suboperación
resolvió el síntoma.

El botón manual puede reconciliar el outbox ERP, manifiesto/configuración y catálogos; el worker
operacional disparado al recuperar la red actúa por separado. Sin logs correlacionados no se puede
distinguir entre una operación que dejó de reintentarse, una cola operacional que se drenó en paralelo,
un refresco de catálogo/configuración o la simple desaparición de una condición transitoria de red.

## Ruta observada y costos posibles

| Función | Hilo/medio | Operación | Duración medida | Posible impacto en UI |
|---|---|---|---|---|
| `BackgroundSyncManager.sync` | JavaScript/WebView | Decide ruta y procesa cola | Sin captura activa física | Comparte el hilo JS para preparación y estado |
| `processCollection('transactions')` | JS + puente nativo + red | Lee toda la colección, filtra/ordena, escribe `SYNCING`, hace un HTTP y escribe el resultado por elemento | Sin captura activa física | JSON, callbacks y reconciliación pueden ocupar el hilo JS; HTTP es asíncrono |
| `CapacitorSQLiteAdapter.readStoredDocuments` | JS + puente SQLite | Páginas de 15 documentos y `JSON.parse` | Sin captura física | Escala con el historial total, no solo con pendientes |
| `updatePendingCount` | JS + SQLite | Lee secuencialmente colecciones operacionales completas | Sin captura física | Puede repetir lecturas históricas y publicar estado React |
| Suscripción de `POSInterface` | React/WebView | Actualiza el estado del componente ante cada publicación | Sin perfil activo físico | Puede reconstruir/reconciliar el árbol principal |
| `CapacitorHttp.request` hacia el destino resuelto | Red/nativo | Envía una transacción por solicitud en la ruta legacy | Sin captura física | La espera de red no debería bloquear JS; serialización/puente/respuesta sí pueden añadir trabajo |

La ruta legacy es la esperada si `sqlite_outbox_v2` conserva su valor predeterminado apagado; no se
capturó el override runtime del cliente. En una sincronización legacy, el conteo previo, el procesamiento
y el conteo final pueden leer la colección de transacciones varias veces. Además, las escrituras SQLite
se serializan. Esto es una hipótesis plausible de escalamiento, pero no una causa demostrada.

## Interpretación de la observación nocturna

Las mediciones instrumentadas del emulador solo descartan degradación por la mera presencia de tres
documentos pendientes mientras la entrada mantiene pausada la sincronización. La prueba cualitativa de
20 operaciones tampoco mostró lentitud percibida al acumular y restablecer la red, aunque no permite
atribuir tiempos ni certificar ACK individuales. El procesamiento activo sospechado sigue sin una traza
correlacionada.
La no reproducción reportada en laboratorio y master-cliente orienta la investigación hacia una
condición de datos, red, carga o estado de la unidad del cliente, sin excluir un defecto de software que
solo se active con el volumen o las características de ese entorno.

Las hipótesis prioritarias para medir en el equipo físico son:

1. Operación o colección específica que estaba reintentándose antes del **Sincronizar Todo** y dejó de
   hacerlo al recuperar la fluidez.
2. Retrasos o reintentos del destino operacional resuelto en esa franja horaria, incluido ERP si el
   perfil era `ERP_ACTIVE`.
3. Crecimiento del historial local que vuelve costosos los escaneos completos y el cruce por el puente Android.
4. Contención con sincronización de inventario, cierres, polling, heartbeat u otras tareas que coincidan de noche.
5. Diferencias de almacenamiento, WebView, GPU, controladores o configuración de esa unidad frente a
   los equipos master-cliente equivalentes que funcionan bien.
6. Presión térmica, memoria o GC después de varias horas de operación.

El destino operacional, incluido el ERP cuando corresponda, debe investigarse para el HTTP, polling y
heartbeat. Supabase solo entra como candidato si se demuestra que el runtime tenía habilitado su canal
Realtime/hints y que esa actividad coincide con el bloqueo. El canal Realtime privado no es candidato
principal bajo la configuración predeterminada.

## Captura mínima pendiente en el equipo del cliente

Reproducir matrices 0, 3 pausadas, 3 activas, 20 y 50+ pendientes, registrando por ciclo:

- timestamp e identificador anónimo de la operación;
- perfil y destino operacional resueltos, además de los valores runtime de los feature flags;
- inicio/fin del HTTP al destino resuelto, código de respuesta, timeout y reintento;
- inicio/fin de cada lectura y escritura SQLite, cantidad y bytes procesados;
- tiempos de `input`→visible e `input`→interactivo, Long Tasks y frames;
- publicaciones del estado de sincronización y renders de `POSInterface`;
- CPU, memoria, temperatura, GC, I/O y versión de Android System WebView;
- modelo/CPU/ABI/RAM, tipo y salud del almacenamiento, `build fingerprint`, GPU y controladores;
- total histórico por colección, además del número pendiente visible.

La comparación de mayor valor es ejecutar esta captura simultáneamente en el equipo afectado y en uno
de los equipos master-cliente equivalentes, con la misma configuración y un volumen de datos comparable.

La causa solo queda probada si la degradación aparece en una de esas matrices y la misma ventana temporal
vincula la operación lenta con el retraso de entrada. Hasta entonces no se debe generar un APK correctivo.

## Higiene del emulador

Los tres documentos sintéticos `qa-perf-*` y el usuario temporal fueron eliminados. Se restauró la sesión
previa y la rotación automática original (`accelerometer_rotation=1`, `user_rotation=0`). No se enviaron
transacciones sintéticas al ERP.
