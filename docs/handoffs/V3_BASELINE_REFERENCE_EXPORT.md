# Exportación local de referencias V3

Este APK candidato agrega un reporte de diagnóstico de solo lectura. No migra ni borra datos, no cambia la vinculación y no desactiva la protección de baseline. No transmite el reporte al ERP ni a Cloud-Admin.

## Uso por AnyDesk

1. Tras actualizar el APK conservando la instalación existente, abrir Centro de Sincronización → Monitor de Datos.
2. En **Inventario de referencias locales V3**, pulsar **Exportar inventario local V3 (solo lectura)** y esperar a que termine. Durante la lectura se ocupa la cola SQLite; realizarla sin operar ventas simultáneamente.
3. El resultado muestra cantidades de tablas, referencias e incidencias, y el JSON completo en pantalla. Si se puede guardar, crea `Documents/Download/clic-v3-inventario-local-<fecha>.json` mediante el plugin Filesystem existente; la ubicación efectiva depende de Android.
4. Transferir ese archivo con las funciones disponibles de AnyDesk o usar **Copiar JSON**. Si el portapapeles no está disponible o el permiso de archivos falla, seleccionar el texto del reporte para copiarlo manualmente o reintentar **Guardar JSON**. El JSON permanece visible aunque falle el guardado.
5. Entregar el JSON para completar el inventario local y preparar la conciliación. El reporte conserva `migrationAllowed: false`; no autoriza ejecutar una migración.

## Cobertura y límites

- Recorre todas las filas de todas las tablas SQLite persistidas dentro de una transacción de lectura, con paginación y hashes de páginas; no se limita al primer bloqueo.
- Enumera claves de autoridad V3 conocidas en JSON, columnas nativas de baseline/sincronización/vinculación y claves foráneas declaradas. Incluye localizadores de registros, rutas, versiones y saldos de inventario.
- No exporta los documentos íntegros ni credenciales o valores de vinculación; las referencias sensibles se representan mediante hashes. El reporte contiene identificadores de empresa, terminal y dispositivo y debe compartirse solo con quienes realizan el diagnóstico.
- No incluye tickets aún en memoria ni relaciones implícitas que la aplicación no declare. JSON malformado, tablas esenciales ausentes o BLOB opaco producen incidencias y `referenceInventoryComplete: false`. No interpretar ese estado como un censo completo.
- Si falla la lectura no se ofrece un reporte parcial. Si la transacción no puede cerrarse, la conexión queda bloqueada para impedir posteriores escrituras sobre una transacción incierta; requiere recuperación de conexión antes de continuar. No se borra ni restaura la BD.

## Validación pendiente en dispositivo

Las pruebas automatizadas verifican paginación, preservación de filas y saldos, bloqueo compartido de escrituras, fallos de lectura/transacción y fallback de pantalla. Quedan pendientes en Master-01 la ejecución con su volumen real, respuesta de WebView, permisos/ruta Filesystem, portapapeles y transferencia por AnyDesk. No se ha instalado ni publicado el APK mediante esta tarea.
