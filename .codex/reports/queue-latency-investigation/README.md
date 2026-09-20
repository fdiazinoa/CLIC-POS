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

El equipo del cliente fue fabricado para Windows y convertido a Android, igual que los equipos
master-cliente usados con éxito en laboratorio. La conversión no explica por sí sola la lentitud. Sí
quedan por comparar diferencias de esa unidad: almacenamiento, WebView, controladores, temperatura,
memoria, configuración y estado local. Que el cliente operara normalmente durante el día y reportara la
lentitud de noche refuerza una causa acumulativa o intermitente, no un costo fijo de la interfaz.

## Medición en emulador

Se midió desde el despacho de `input` hasta dos `requestAnimationFrame`, alternando búsquedas `fr` y
`fra` en la aplicación instalada.

| Escenario | n | p50 | p95 | p99 | máximo | Estado de cola |
|---|---:|---:|---:|---:|---:|---|
| 0 pendientes | 100 | 33.30 ms | 34.30 ms | 34.40 ms | 50.40 ms | sin cola |
| 3 pendientes, sincronización pausada por entrada | 100 | 33.30 ms | 34.50 ms | 34.50 ms | 34.90 ms | 3 `PENDING` |

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

La prueba del emulador solo descarta degradación por la mera presencia de tres documentos pendientes
mientras la entrada mantiene pausada la sincronización; no cubre el procesamiento activo sospechado.
La no reproducción reportada en laboratorio y master-cliente orienta la investigación hacia una
condición de datos, red, carga o estado de la unidad del cliente, sin excluir un defecto de software que
solo se active con el volumen o las características de ese entorno.

Las hipótesis prioritarias para medir en el equipo físico son:

1. Retrasos o reintentos del destino operacional resuelto en esa franja horaria, incluido ERP si el
   perfil era `ERP_ACTIVE`.
2. Crecimiento del historial local que vuelve costosos los escaneos completos y el cruce por el puente Android.
3. Contención con sincronización de inventario, cierres, polling, heartbeat u otras tareas que coincidan de noche.
4. Diferencias de almacenamiento, WebView, GPU, controladores o configuración de esa unidad frente a
   los equipos master-cliente equivalentes que funcionan bien.
5. Presión térmica, memoria o GC después de varias horas de operación.

Supabase debe considerarse si la traza muestra que polling/hints/heartbeat coinciden con el bloqueo o si
el runtime tenía habilitado un override de Realtime. El canal Realtime privado no es candidato principal
bajo la configuración predeterminada.

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
