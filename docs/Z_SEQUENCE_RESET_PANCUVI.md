# Reinicio de secuencia Z después de pérdida de la base local

## Resultado

El reinicio de numeración y la reincorporación de ventas comparten un detonante posible (pérdida/restauración de la base), pero usan estados distintos y no tienen la misma causa técnica.

- La reincorporación de ventas ocurre cuando una venta ya cerrada vuelve a `transactions` sin su pertenencia al Z.
- El reinicio de numeración ocurre cuando `internalSequences` y `config.terminals[].config.documentSeries` se reconstruyen desde una serie ERP atrasada y no existe historial Z local que demuestre los números consumidos.

No se dispone de la SQLite ni de los logs de PANCUVI. Por eso el vínculo causal del incidente remoto sigue pendiente de evidencia local/ERP. El mecanismo de reinicio sí quedó reproducido independientemente en el emulador.

## Evidencia reproducida

Emulador `127.0.0.1:6555`, CLIC-POS 1.1.311, empresa Clic-Suite / terminal Caja 2:

1. Android registró `clearApplicationUserData` el 08/09/2026 a las 06:41:24.
2. Después de revincular, la SQLite contenía una serie Z ERP con el mismo `seriesId` en ambos catálogos.
3. `documentSeries.nextNumber=1`, sin revisión ni máximo confirmado por ERP.
4. El POS emitió `ZS0022000001` y dejó `internalSequences.nextNumber=2` únicamente después de emitirlo.
5. ERP mostró para la misma caja `ZS0022000001`, `ZS0022000002` y nuevamente `ZS0022000001`.

La actualización APK mediante `adb install -r` no elimina la base. El evento reproducido fue un borrado explícito de datos de la aplicación. Una actualización puede volver a sincronizar configuración, pero por sí sola no explica la pérdida de la SQLite.

## Defensa POS

Antes de cualquier persistencia, impresión, archivado o sincronización del Z:

- se calcula un límite inferior con los cierres locales de la terminal y de la misma serie/prefijo;
- un código visible ya usado sigue ocupado aunque una reasignación haya cambiado el `seriesId`;
- una serie `ERP_TERMINAL_CONFIG` debe incluir `sequenceRevision` durable;
- si ERP incluye `lastCommittedNumber`, `nextNumber` debe ser estrictamente mayor;
- el reporte conserva `sequenceContinuity` con serie, revisión, máximo local/ERP, número seleccionado e IDs internos usados como evidencia;
- si falta evidencia o está atrasada, el Z no se crea, el contador no avanza y las operaciones quedan pendientes.

El máximo local es una defensa contra colisiones conocidas; no constituye autoridad global ni demuestra disponibilidad.

## Contraparte obligatoria ERP

Para cada `(tenant, company, store, terminal, seriesId)`, ERP debe:

1. conservar un contador durable monotónico con `sequenceRevision`, `lastCommittedNumber` y `nextNumber`;
2. derivar el piso inicial de todos los Z originales recibidos, incluidos los anteriores al borrado, sin renumerarlos;
3. devolver esos campos en la serie asignada del snapshot autenticado de la terminal;
4. aceptar un Z solo mediante compare-and-set de la revisión esperada;
5. imponer unicidad futura de terminal + serie + número y devolver conflicto con la revisión/`nextNumber` actuales;
6. procesar un reintento del mismo `source_z_report_id` de forma idempotente;
7. no aceptar que un push de catálogo reduzca contador, revisión o máximo;
8. mantener los cierres duplicados históricos como evidencia y aplicar la conciliación mediante relaciones/auditoría, sin borrarlos ni renumerarlos.

Para PANCUVI, ERP debe calcular el siguiente disponible usando toda la historia de Caja 01. Dado que existe un Z 009, el piso no puede ser menor que 010. El valor definitivo debe salir de la consulta completa por `seriesId` y prefijo, no solo de los tres reportes citados.

## Validación requerida antes de desplegar

- Base continua: 009 produce 010.
- Base borrada: snapshot ERP con máximo 009 produce 010.
- Snapshot atrasado o sin revisión: cierre bloqueado sin efectos.
- Cambio de `seriesId` conservando prefijo: no reutiliza un código visible.
- Reintento del mismo Z: mismo ID y resultado.
- Dos solicitudes con la misma revisión: una confirma; la otra recibe conflicto y el siguiente autoritativo.
- Reinicio entre reserva/commit: no consume dos números ni reemplaza el intento pendiente.
- Sin red y sin evidencia durable posterior al borrado: permite vender, pero bloquea el Z hasta recuperar autoridad.

