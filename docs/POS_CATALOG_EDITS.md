# Sincronización automática de cambios del catálogo

El usuario edita y guarda en las pantallas actuales del POS. No existe una pantalla de propuestas ni se requiere consultar o enviar manualmente al ERP.

## Alcance actual

- Precio base de artículos existentes: editor de producto, precio rápido y cambios de precio base desde TariffForm. Los precios exclusivos de tarifas/overrides siguen fuera de este contrato.
- Nombre y código de clasificaciones existentes desde ClassificationManager.
- El guardado masivo conserva su API actual y captura las diferencias de precio resultantes; si falla el registro de la cola, informa el error en el flujo masivo.
- No incluye altas/bajas, jerarquía, asignación producto-clasificación, impuestos ni operaciones.

## Guardado y envío

`saveLocalProducts` / `saveLocalClassifications` comparan valores anteriores con nuevos por ID y campo. Guardar sin cambios, modificar otros campos o representar un código ausente como vacío no genera mutaciones. Los guardados individuales persisten el maestro y la cola en la misma transacción local; un fallo aborta ambos.

Los cambios reales se envían automáticamente tras guardar y mediante el proceso de sincronización en segundo plano. Sin red sobreviven al reinicio. Se conservan identidad, tenant, compañía, dispositivo, terminal y URL; las ediciones sucesivas del mismo campo esperan confirmación de su predecesora. Un conflicto no provoca sobrescrituras ni envío de dependientes.

Los snapshots CONFIG_PUSH_V2 preservan campos locales con cambios pendientes y no generan mensajes de retorno. Los estados se muestran en el monitor de sincronización que ya existe. No hay otro paso requerido para un guardado normal.

IndexedDB usa versión 23 y colección `catalogEdits`; SQLite utiliza documentos existentes. Configuración: `VITE_POS_CATALOG_EDITS_ENABLED=true`, desactivada por defecto; ERP exige habilitación global y por terminal. La vinculación debe estar completa antes de habilitar el piloto.

## Backend e integración pendientes

Backend compañero: CLIC-ERP PR #2043. La mutación compara el valor anterior y persiste el resultado atómicamente. `APPLIED` confirma escritura ERP, no recepción en otros POS. Hay que aplicar la migración en pruebas y verificar/conectar la publicación CONFIG_PUSH_V2 del backend desplegado antes de uso operativo. No se ha desplegado ni generado APK.

Smoke: habilitar una terminal de prueba, guardar sin cambiar nada y comprobar cola vacía; modificar precio base y nombre/código, comprobar envío automático y recepción ERP; repetir sin red, tras reinicio, con ediciones sucesivas y con conflicto. Verificar publicación a dos POS.

## Validación

- `npm run test:catalog-sync`: pruebas de guardados automáticos, no-op, cola, persistencia y recepción ERP. El runner compila la integración con el flag Vite habilitado, sin credenciales ni llamadas externas.
- `npm run build`.
- Lint TypeScript focalizado. El lint global preexistente carece de configuración plana ESLint 9.
