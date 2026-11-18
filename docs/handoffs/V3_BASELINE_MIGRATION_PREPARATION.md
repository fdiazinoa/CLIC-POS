# Preparación de migración V3 con evidencia local

## Estado y alcance

**Preparación; ejecución bloqueada. No es una migración aplicada ni un script listo para producción.**

La captura del POS confirma `SYNC_V3_BASELINE_MIGRATION_REQUIRED`. El ERP publica los artículos y precios investigados; el equipo remoto solo está accesible visualmente por AnyDesk. Todavía no conocemos su versión de catálogo activa, la base de inventario que referencia ni el identificador del movimiento/documento bloqueante. No se debe atribuir el fallo a un artículo concreto sin esa evidencia.

Este cambio añade evidencia al rechazo existente: primer registro semánticamente incompatible y campos antes/después, versiones comparadas y primera referencia local que impide reemplazar una base usada. El rechazo y el rollback originales permanecen. No crea un camino de activación, no borra, no actualiza documentos ni toca credenciales.

## Recoger el diagnóstico sin migrar

En el APK que contenga este cambio, ejecutar la sincronización manual y capturar el mensaje completo:

- `Cambio`: dataset, SKU o identificador, versión anterior y candidata. Para artículos la comparación usa la versión del **inventario base**, que puede diferir de la versión del catálogo activo.
- Campos: tipo/inventariable, unidades, factor, impuestos y flags; o cambios de tarifa/variantes. El precio y el nombre no forman parte de esa comparación.
- `Referencia local`: colección e identificador del primer movimiento o documento que mantiene la base ocupada.
- `Ruta`: campo exacto de autoridad dentro del documento, o registro ilegible. No se copia el documento completo ni su información de cliente/pago.

Es el primer rechazo observado; **no es un censo completo**. La migración requiere inventariar también las demás referencias, incluso de artículos distintos al que cambió. Un registro ilegible bloquea el proceso hasta recuperar su contenido por un procedimiento separado; no se elimina.

## Evidencia necesaria antes de escribir una migración ejecutable

1. Copia consistente y verificable de SQLite y de la identidad/configuración local, mantenida bajo acceso restringido. No publicar credenciales. Comprobar restauración sobre una copia aislada, no en el POS operativo.
2. Registrar catálogo activo, catálogo validado pendiente y base de inventario, con sus identificadores, versiones, cursores, ámbito y hashes; comprobar terminal, dispositivo, empresa, tienda, almacenes y tarifas.
3. Enumerar y conservar byte a byte movimientos, ventas, historial, tickets en espera, reservas, fuentes restauradas, pagos e intentos fiscales. Contar filas y hashear las colecciones antes y después.
4. Obtener del ERP una evidencia de cobertura por operación: qué ventas/movimientos ya incluye el snapshot nuevo y cuáles siguen pendientes o rechazados. Un ACK de transporte, un cursor o una fecha por sí solos no prueban cobertura de stock. Una operación sin evidencia mantiene la migración bloqueada.
5. Clasificar cada cambio semántico. Una conversión de unidades requiere factor explícito, precisión y equivalencia verificable por artículo/almacén. No deducir conversiones por nombres, no redondear pérdidas ni reinterpretar cantidades antiguas. Cambios de impuestos, seguimiento, lotes/series o variantes necesitan su contrato específico; sin él no son migrables.
6. Verificar las referencias originales necesarias para devoluciones, notas de crédito y reservas. Facturas emitidas conservan su foto fiscal, precios e impuestos y su autoridad original (`v3RefundAnchor`); no se reestampan al maestro nuevo.

## Diseño del plan de migración, todavía no autorizado para activar

- Identificador idempotente derivado de identidad, base origen, candidato, evidencia de cobertura y hashes. Una evidencia cambiada invalida el plan.
- Simulación sobre la copia: particionar por artículo/almacén y reconciliar cada operación una sola vez contra la cobertura del ERP. Preservar reservas/compromisos y autoridades de lotes, series y presentaciones. No sumar todos los deltas históricos al snapshot nuevo: duplicaría movimientos ya recibidos.
- Conservar el maestro y las referencias originales para operaciones históricas. La nueva relación entre autoridades debe almacenarse por separado y probarse con devoluciones/reimpresiones; nunca falsificar la pertenencia de documentos anteriores a la base nueva.
- El plan debe mostrar saldos esperados, operaciones incluidas/excluidas y cualquier ambigüedad. Cualquier ambigüedad impide ejecutar.
- Activación futura bajo la cola de escritura nativa y ventana operacional: revalidar identidad, versiones, hashes, ausencia de cambios desde la simulación e intentos financieros en curso. Persistir snapshot conciliado, relación de autoridades y recibo de migración en una transacción; comprobar lectura antes de publicar la nueva sesión.
- Un fallo antes del commit conserva íntegros los punteros y autoridades previos. No borrar staging ni fuentes históricas para hacer pasar el guardián.
- La reversión de punteros solo sería válida antes de nuevas operaciones bajo la autoridad migrada y tras comprobar las mismas precondiciones. Con actividad posterior, diseñar una compensación auditada; no revertir ventas o contadores mediante restauración ciega.

## Pruebas de aceptación de la futura ejecución

- Catálogo/precio actualizado; mismas ventas, pagos, secuencias, pairing y credenciales.
- Saldo por artículo/almacén y cobertura por operación conciliados sin duplicación, con fracciones y conversiones explícitas.
- Tickets/reservas, devoluciones y documentos fiscales históricos conservan sus fuentes originales.
- Fallos inyectados antes/después de cada escritura: rollback; reintento idempotente; reinicio y lectura consistentes.
- Cambios concurrentes de identidad, catálogo, inventario o pagos impiden la activación.
- Prueba primero sobre una copia y después un canario autorizado. No activar en el equipo remoto con la evidencia actual.

## Qué falta para este incidente

Captura del diagnóstico ampliado y lectura consistente de las referencias locales. Hasta obtenerlas, no hay un cambio/ref local confirmado y no puede emitirse un plan numérico ni SQL de migración seguro. La protección permanece activa.
