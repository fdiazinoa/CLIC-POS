# Implementación: destino operacional Master/ORDER_TAKER

Autor: `/root/routing_developer`, 2026-09-16. Base `428db404f11b1ccb0f046c0d1541c7cc1d2abf2f`. Implementación del plan aprobado por `/root`, distinto del analista `/root/routing_analyst`. No es aprobación QA/performance/release.

## Causa y límites

El mapa conservaba una URL validada en una ref independiente mientras abrir/bloquear/guardar resolvían otra vez los mirrors. ORDER_TAKER sin `pos_master_ip` podía caer en operación local. El arranque usaba `isPrimaryNode` para borrar el puntero incluso en una toma de pedidos. Esto demuestra un mecanismo de divergencia en fuente y fixtures; no determina quién escribió históricamente la IP propia del equipo.

El resolver compartido valida UUID de master, tenant/empresa/sucursal y rol ERP, así como self IP/UUID/device y loopback. Una identidad runtime explícita discordante nunca se rescata mediante token viejo. LOCAL_ONLY explícito (`masterSetupContext.erpEnabled=false`) conserva pairing LAN legacy sin exigir ERP y valida identidad/rol disponibles. No adopta bindings ni cambia identidades.

La caché vive en memoria, está ligada al contrato activo y valida una sola vez en primer uso concurrente. Los mirrors se reparan desde la caché validada, nunca al revés. Retry explícito invalida y usa discovery existente. Se descartan candidatos repetidos y se termina al primer candidato compatible; no hay nuevo polling idle. Direcciones locales se obtienen mediante status nativo una vez por sesión, bajo demanda. Si el bridge falla, siguen los controles de UUID/device y loopback; no se afirma disponer de todas las interfaces locales.

Lecturas y escrituras de App, TableMap y POSInterface usan el resolver común. La escritura sin await que queda en App está dentro de `!isClientTerminalMode()` y exclusivamente del camino Master; usa el mismo resolver síncrono para loopback. Los timeouts de transporte no comienzan hasta resolver el endpoint.

El login muestra el código/nombre/label/UUID activo. PR716 de persistencia de identidad ya está en la base y se conserva sin cambios. No se modificaron SQLite operacional, sincronización/cadencia, cobro, catálogo, bindings ERP, versiones ni APK.

## Medición ligera

El último input de PIN autorizado proporciona únicamente timestamp monotónico; nunca PIN ni credenciales. Se mide el commit del destino POS o mapa, rAF prepaint y la tarea siguiente. Son proxies, **no DisplayPresent ni demostración de respuesta real a entrada**. Timestamp ausente/inválido se etiqueta `handler-fallback` y no entra en percentiles de input completo. Historial 300 traces, pending por destino 20, long tasks por trace 50. Observer existente admite delivery tardío mediante solapamiento temporal; intervalos incompletos mayores de 10s se etiquetan como truncados. No loops rAF, nuevo observer persistente ni profiler masivo. No se afirma corregida la latencia de primer ingreso.

## QA físico pendiente de APK expresamente autorizado

1. Conservar BD/config/device de master101 y cliente123; registrar UUID, rol y scope antes y después, sin limpiar ni transferir.
2. Login autorizado en ambos: primer ingreso, destino y proxies separados. Repetir al menos 10 selecciones/aperturas/cierres de mapa, primera apertura separada.
3. En cliente: GET mesas, acquire/open/save/unlock/unir/liberar siempre contra101, nunca123/loopback. Dos operadores no sobrescriben mesa ocupada.
4. Guardar/reabrir ticket existente de prueba conservando líneas y lock; cancelar/salir libera según política. No generar venta financiera para validar routing.
5. Reiniciar ambos sin borrar datos; vínculo, ORDER_TAKER y CAJA-2 permanecen. Simular master no disponible sin permitir fallback local o cambiar binding.
6. Idle30s visible/segundo plano y comparativa cuantitativa antes/después con muestras y sesiones requeridas por el gate performance. PSS app/renderer correctamente atribuidos; frames/proxies no intercambiables.

QA físico candidato y performance permanecen BLOCKED hasta APK del SHA exacto autorizado y pruebas independientes. APK1.1.394 no contiene este fix, por lo que probarlo no acredita el candidato.
