# Sincronización automática de cambios del catálogo

El usuario edita y guarda en las pantallas actuales del POS. No existe una pantalla de propuestas ni se requiere consultar o enviar manualmente al ERP.

## Alcance actual

- Precio base de artículos existentes: editor de producto, precio rápido y cambios de precio base desde TariffForm.
- Nombre y código de clasificaciones existentes desde ClassificationManager.
- Relaciones padre/hijo de secciones, familias y subfamilias desde el selector existente del ClassificationManager.
- El guardado masivo conserva su API actual y captura las diferencias de precio resultantes; si falla el registro de la cola, informa el error en el flujo masivo.
- Reclasificación de artículos existentes: departamento, sección, familia, subfamilia, marca y categoría POS.
- Impuestos asignados a artículos existentes, incluyendo quitar todos los impuestos.
- Operaciones del artículo: controlar inventario, precio abierto, venta solo en enteros, inventario negativo, producto pesado, etiquetas, edad, exclusión de promociones/puntos, lotes/vencimientos y números de serie.
- Precios particulares por tarifa: precio, margen, activación y eliminación. Cada tarifa se sincroniza de forma independiente; editar la tarifa base no genera una segunda mutación de precio duplicada.
- Datos generales de artículos existentes: nombre, descripción, SKU, referencia, tres códigos de barra, costo, tipo, unidades de inventario/compra y estado activo. Los códigos de barra se envían como un único cambio para no dejar combinaciones parciales.
- Altas de artículos con UUID y numeración del rango offline asignado a la terminal; sus campos restantes esperan la confirmación de la creación antes de enviarse.
- Altas, activación/desactivación y bajas de clasificaciones. Las nuevas clasificaciones usan UUID y respetan la jerarquía padre/hijo.
- Bajas seguras de artículos y clasificaciones: la eliminación local y su mutación se guardan juntas; un snapshot anterior no reaparece el registro mientras esté pendiente. El ERP rechaza registros en uso y el snapshot siguiente los restaura.
- El mantenimiento global de definiciones de impuestos conserva su contrato separado; este alcance cubre la asignación de impuestos a cada artículo.

## Guardado y envío

`saveLocalProducts` / `saveLocalClassifications` comparan valores anteriores con nuevos por ID y campo. Guardar sin cambios, modificar otros campos o representar un código ausente como vacío no genera mutaciones. Los guardados individuales persisten el maestro y la cola en la misma transacción local; un fallo aborta ambos.

Los cambios reales se envían automáticamente tras guardar y mediante el proceso de sincronización en segundo plano. Impuestos, operaciones, precios particulares y datos generales se comparan por campo: no se envía el artículo completo ni se crea una mutación al guardar sin cambios. Sin red sobreviven al reinicio. Se conservan identidad, tenant, compañía, dispositivo, terminal y URL; las ediciones sucesivas del mismo campo esperan confirmación de su predecesora. Un conflicto no provoca sobrescrituras ni envío de dependientes.

Los snapshots CONFIG_PUSH_V2 preservan campos, altas y bajas locales con cambios pendientes y no generan mensajes de retorno. Los estados se muestran en el monitor de sincronización que ya existe. No hay otro paso requerido para un guardado normal. Una alta de artículo confirmada registra también el consumo de su número para el reporte de progreso del rango.

IndexedDB usa versión 23 y colección `catalogEdits`; SQLite utiliza documentos existentes. Configuración: los builds de producción definen `VITE_POS_CATALOG_EDITS_ENABLED=true`; ERP mantiene la autorización por terminal mediante `posCatalogEdits.enabled`. La vinculación debe estar completa antes de aceptar cambios.

## Backend e integración pendientes

Backend compañero: CLIC-ERP PRs #2043, #2045 y #2046. La mutación compara el valor anterior y persiste el resultado atómicamente. `APPLIED` confirma escritura ERP, no recepción en otros POS. Las migraciones y endpoints están desplegados para la terminal piloto; CONFIG_PUSH_V2 continúa distribuyendo los cambios confirmados a los demás POS.

Smoke: habilitar una terminal de prueba, guardar sin cambiar nada y comprobar cola vacía; modificar precio base y nombre/código, comprobar envío automático y recepción ERP; repetir sin red, tras reinicio, con ediciones sucesivas y con conflicto. Verificar publicación a dos POS.

## Validación

- `npm run test:catalog-sync`: pruebas de guardados automáticos, no-op, cola, persistencia y recepción ERP. El runner compila la integración con el flag Vite habilitado, sin credenciales ni llamadas externas.
- `npm run build`.
- Lint TypeScript focalizado. El lint global preexistente carece de configuración plana ESLint 9.
