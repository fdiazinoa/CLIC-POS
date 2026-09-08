# Solapamiento de cierres Z — PANCUVI SRL, Caja 01

## Alcance y preservación de evidencia

Este diagnóstico no modifica la terminal del cliente. La Caja 01 no está accesible por ADB desde el entorno de desarrollo, por lo que la base local y sus logs todavía no forman parte de la evidencia recibida. La APK release declara `android:allowBackup="false"`; no se debe desinstalar, limpiar datos, reinstalar ni intentar un downgrade para extraerlos.

Antes de operar nuevamente sobre la terminal, soporte debe preservar, cuando disponga de acceso autorizado:

1. Copia binaria consistente del directorio privado de `com.clicpos.app`, incluidas la base SQLite, `-wal`, `-shm`, Preferences y archivos. Esto requiere la herramienta de soporte del fabricante o acceso privilegiado; `adb pull` ordinario no puede leer el directorio privado de una APK release.
2. `adb logcat -d -v threadtime`, información de paquete (`dumpsys package com.clicpos.app`) y hora/zona del dispositivo.
3. Exportaciones ERP inmutables de las ventas TCKS001001158–TCKS001001396, ambos Z, sus payloads originales, eventos de recepción/ACK y la cola de sincronización asociada.
4. SHA-256 de cada archivo copiado y una nota con fecha, operador, equipo y método de extracción.

No debe abrirse otro cierre para “corregir” los anteriores ni generarse una venta, NC, cobro o movimiento compensatorio.

## Evidencia confirmada

- El release 1.1.303 fue generado desde `4791fca`.
- El cierre del 07/09 contiene TCKS001001158–TCKS001001317.
- ZS001000002 contiene TCKS001001252–TCKS001001396: 145 ventas por RD$46,984.17.
- La intersección contiene 66 ventas por RD$28,451.10.
- El tramo exclusivo TCKS001001318–TCKS001001396 contiene 79 ventas por RD$18,533.07.
- RD$28,451.10 + RD$18,533.07 = RD$46,984.17.
- La apertura calculada del segundo cierre precede al cierre anterior, consistente con la presencia de ventas antiguas en su conjunto de entrada.

## Defecto reproducido en el código

En 1.1.303 y todavía en 1.1.311, el polling de la caja Master recibe ventas y las guarda directamente en `transactions`; luego agrega todas las recibidas al estado React. No consulta `transactionHistory` ni la pertenencia a un Z antes de persistirlas. El ACK se envía después.

El cierre archiva una venta con `zReportId` y la elimina de `transactions`, pero primero guarda y transmite el Z. Un reenvío concurrente o posterior puede insertar otra vez la copia recibida sin `zReportId`.

`ZReportDashboard` considera pendiente cualquier fila activa de la terminal sin `zReportId` y envía esos IDs explícitos a `handleZReport`. Esa ruta explícita no aplica el filtro temporal de `getPendingTransactionsForTerminal`. Por ello, una copia reinsertada puede formar parte de un segundo cierre aunque su fecha sea anterior.

Esto demuestra un mecanismo capaz de producir el solapamiento observado. La atribución definitiva del incidente de PANCUVI requiere confirmar en la copia local o en los eventos ERP que los 66 IDs estaban simultáneamente en `transactionHistory` con el primer `zReportId` y en `transactions` sin él, o que fueron entregados nuevamente por la cola.

## Corrección propuesta

La pertenencia se decide por ID exacto, nunca por fecha:

- Un ID presente en `transactionHistory` con `zReportId` está cerrado.
- Los Z nuevos conservan siempre un manifiesto `recoveryMemberIds.transactions` desde su primera persistencia, antes de terminar el archivado fila por fila.
- Polling, full pull, delta y restauración filtran contra esa pertenencia.
- Un reenvío cerrado se reconoce y se confirma técnicamente para detener su repetición, pero no se vuelve a guardar como venta activa ni se reaplican inventario, cobros o contabilidad.
- Una venta con ID distinto y sin pertenencia cerrada sigue pendiente.
- Antes de emitir un Z se repite la validación. Si el conjunto que el usuario revisó contiene un miembro cerrado, el cierre se bloquea completo y se solicita una revisión nueva; no se filtran filas silenciosamente dentro del cierre ya confirmado.

La prueba PANCUVI reproduce 145 filas/RD$46,984.17 y verifica que la corrección excluye las 66 filas/RD$28,451.10 ya cerradas, conservando 79 filas/RD$18,533.07 como pendientes legítimas.

## Conciliación de los cierres afectados

Los originales deben permanecer inmutables:

1. Conservar el cierre del 07/09 y ZS001000002 exactamente como fueron recibidos e impresos.
2. Crear en ERP un registro de conciliación administrativa ligado a ambos IDs de cierre, no un documento comercial. Debe guardar la lista exacta de los 66 IDs, su hash, RD$28,451.10, el operador, la fecha y el motivo `Z_MEMBERSHIP_OVERLAP`.
3. Registrar para informes:
   - ZS001000002 original: 145 ventas, RD$46,984.17.
   - Solapamiento informativo: 66 ventas, RD$28,451.10.
   - Atribución exclusiva conciliada: 79 ventas, RD$18,533.07.
4. No crear ventas negativas, NC, devoluciones, cobros, movimientos de inventario ni asientos para compensar: las ventas originales ya existen y solo la pertenencia al reporte está duplicada.
5. Los reportes consolidados deben contar cada venta una sola vez por su ID original. Deben permitir ver tanto el Z original como el ajuste de pertenencia, sin reescribir los payloads históricos.
6. Comparar por ID que ventas, pagos, inventario y asientos comerciales existen una sola vez. Si alguno está duplicado fuera del Z, tratarlo como una incidencia separada y no usar esta conciliación para ocultarlo.
7. Finance/operación debe aprobar el registro de conciliación y adjuntar el papel, los payloads y los hashes de la evidencia.

## Evidencia pendiente de PANCUVI

- Contenido local de `transactions`, `transactionHistory` y `zReports` de Caja 01.
- `zReportId` y `zReportSequence` de cada una de las 66 ventas en historial.
- Payload exacto que reintrodujo cada ID y su estado de ACK.
- Estado de la cola en el Master/ERP alrededor de ambos cierres.
- Logs de `Z-Report`, `TransactionSync`, archivado, reset y sync durante el intervalo.

Hasta obtenerla, la causa queda clasificada como **mecanismo reproducido y corrección validada offline; atribución del incidente pendiente de evidencia local/de cola**.
