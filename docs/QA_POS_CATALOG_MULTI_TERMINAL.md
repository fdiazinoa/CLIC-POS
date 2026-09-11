# QA del catálogo entre terminales

Esta prueba valida el circuito real POS A → ERP → POS B sin crear datos comerciales ni generar otro APK.

## Preparación

- Dos terminales instaladas con la misma versión release, vinculadas al mismo tenant y compañía con identidades distintas.
- `posCatalogEdits.enabled=true` en ambas terminales.
- Un artículo de prueba no usado para validar bajas y una clasificación de prueba.
- Un rol de pruebas con los cinco permisos `POS_CATALOG_CONFLICT_*` y otro sin `POS_CATALOG_CONFLICT_FORCE`.
- Registrar versión, terminal IDs, usuario, hora inicial y valores originales para poder restaurarlos.

## Circuito principal

1. En POS A guardar sin cambios. Confirmar que no aparece una mutación nueva.
2. Desconectar POS A y modificar sucesivamente el precio base, impuestos, una operación y un dato general del artículo.
3. Cerrar completamente la aplicación, abrirla todavía sin red y confirmar que las mutaciones continúan pendientes con los mismos IDs.
4. Reconectar POS A. Confirmar `APPLIED` en orden y que el ERP muestra el último valor de cada campo.
5. En POS B solicitar sincronización. Confirmar los valores canónicos recibidos y que no se crearon mutaciones de retorno.
6. Repetir con precio por tarifa, reclasificación, relación padre/hijo, alta/desactivación y baja segura.

## Conflicto y permisos

1. Cambiar el mismo campo en ERP y POS A partiendo del valor anterior. Confirmar `CONFLICT` y el valor vigente del ERP.
2. Con el rol limitado, confirmar que “Forzar” no aparece y que el endpoint rechaza una mutación marcada `FORCE`.
3. Probar por separado Reintentar, Descartar y Aceptar ERP. Confirmar actor y hora en la auditoría.
4. Con el rol autorizado, Forzar. Confirmar una mutación nueva que referencia la original y después el valor en POS B.

## Evidencia de aceptación

Conservar capturas o exportes del monitor en A y B, el resultado ERP, IDs de mutación, timestamps y tiempo de propagación. La prueba se acepta solo si no hay duplicados, pérdida de cola tras reinicio, eco de snapshots, mezcla entre compañías ni acciones visibles para roles no autorizados.

La cobertura automática equivalente se ejecuta con `npm run test:catalog-sync`; no sustituye esta comprobación de SQLite/WebView/red en los dos dispositivos.
