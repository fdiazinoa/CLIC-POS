# Exportación local de referencias V3 con memoria acotada

El APK anterior 1.1.659 acumulaba todo el censo, lo serializaba completo y lo mostraba en un textarea. Además, paginar por número de filas no limitaba el tamaño de una celda SQLite que cruzaba al WebView. Son riesgos comprobados en el código; sin logs nativos no se ha confirmado la causa del cierre de Master-01.

## Uso por AnyDesk

1. Actualizar conservando la instalación existente; no desinstalar, borrar datos, restaurar ni vincular de nuevo.
2. Sin cobros simultáneos, abrir Centro de Sincronización → Monitor de Datos → **Exportar inventario local V3 (solo lectura)**.
3. Se muestra progreso de tabla, filas y referencias. La lectura ocupa la cola SQLite para mantener un snapshot consistente; las escrituras esperan. **Cancelar exportación** cierra la lectura sin modificar datos; salir de la pantalla también solicita cancelación.
4. Al finalizar, transferir por AnyDesk el archivo indicado: `Documents/Download/clic-v3-inventario-local-<identificador>.jsonl`. Es JSON Lines: un objeto JSON por línea; no renombrarlo a `.json` ni tratarlo como un único objeto JSON.
5. La pantalla solo muestra una **vista parcial limitada**, que se puede copiar manualmente. El censo completo está en el archivo, no en el texto visible.

## Conservación y límites

- Solo SELECT/PRAGMA y control de transacción de lectura en SQLite; ninguna migración, borrado, escritura de ventas/saldos, cambio de owner, token, vinculación o protección. No hay envío de red.
- Antes de leer filas se consultan sus longitudes SQL. Cada lote limita los datos crudos a 128 KiB; el envoltorio JSON del bridge puede expandirlos hasta aproximadamente seis veces más las claves del esquema. Una fila que exceda ese presupuesto detiene la exportación e indica tabla, tamaño y límite; no se lee su payload ni se recorta silenciosamente.
- Las referencias se emiten de forma incremental, sin arrays globales de documentos, referencias, saldos, incidencias o hashes de páginas. Las líneas y escrituras al archivo tienen un máximo exacto de 32 KiB UTF-8. La vista parcial retiene como máximo 2048 unidades UTF-16 (menos de 8 KiB UTF-8), independientemente del volumen total.
- Cada escritura de archivo se espera antes de continuar: no se acumulan promesas ni buffers sin límite. El árbol JSON se recorre con marcos por profundidad, sin copiar rutas completas para cada descendiente.
- El archivo inicial lleva sufijo `.partial`. Solo después de COMMIT y de reconfirmar vinculación/cancelación se escribe el cierre y renombra a `.jsonl`. Si el proceso es terminado por Android, un `.partial` nunca se considera censo completo. Ante error/cancelación se intenta eliminar solo los archivos de diagnóstico propios; si falla esa limpieza, se informa expresamente. No se toca la BD.
- Un fallo de permisos/espacio al crear el archivo detiene antes de abrir el snapshot. Revisar permisos de archivos y espacio; no borrar datos del POS para resolverlo. Se eliminó el fallback que construía el JSON completo en memoria.
- Un rollback que no confirma el cierre conserva la cuarentena del adaptador antes de liberar su cola. No se permite operar sobre una conexión incierta.

## Formato y cobertura

Esquema 2: eventos `header`, `scope`, `table`, `page`, `reference`, `balance`, `version`, `issue`, `table_end`; el último evento `complete` contiene el resumen. `migrationAllowed` siempre es `false`.

La cobertura conserva todas las filas/tablas SQLite persistidas y las claves de autoridad V3 conocidas, columnas nativas baseline/sync/binding y claves foráneas declaradas. Excluye estado UI sin persistir y relaciones implícitas no declaradas. No exporta documentos completos, datos de clientes o credenciales. Las claves privadas y referencias sensibles se representan mediante hashes.

Las celdas BLOB se sustituyen por un marcador y una incidencia, sin cruzar su contenido al bridge. Los hashes de página corresponden a esa proyección y lo declaran en `scope`. JSON malformado, BLOB opaco o tabla esencial ausente dejan `referenceInventoryComplete:false`. Un archivo final con incidencias no autoriza migración ni equivale a cobertura completa. Una fila/entrada excesiva, error de lectura/disco o cancelación impiden publicar un resultado final satisfactorio.

## Evidencia técnica y límites físicos

Las pruebas automatizadas cubren 100.000 referencias sin acumular el reporte, páginas y escritura acotadas, Unicode/escape JSON, celda grande rechazada antes del bridge, datos/saldos conservados, backpressure, permisos/disco, cancelación, identidad, BEGIN ambiguo, cuarentena, rename con respuesta perdida y cleanup fallido. No acreditan aún el uso real de memoria Android, permisos Filesystem, ruta, transferencia AnyDesk o estabilidad física sobre la BD de Master-01. No se ha instalado ni publicado por esta tarea.
