# Cambios al ERP desde el POS

Primera entrega controlada: Configuración → Cambios al ERP permite proponer cambios al **precio base** de artículos existentes y al **nombre/código** de clasificaciones. Es una pantalla específica; los otros formularios locales no se convierten automáticamente en editores ERP.

## Comportamiento

- Bandera de build: `VITE_POS_CATALOG_EDITS_ENABLED=true`, desactivada por defecto.
- Acceso: usuario con `CATALOG_MANAGE`, terminal vinculada a `ERP_ACTIVE` y autorización del backend.
- Consultar ERP trae hasta 100 coincidencias por nombre y conserva la última consulta de cada dominio para uso sin conexión.
- La propuesta se persiste antes del envío. No modifica inmediatamente el maestro local; el valor operativo llega por el canal habitual ERP → POS.
- La cola reintenta errores con espera creciente, conserva ID/payload y comprueba terminal, tenant, compañía conocida, dispositivo y URL antes de enviar. No migra propuestas a otra vinculación.
- Un `APPLIED` confirma que el ERP guardó el campo. No confirma que todos los POS hayan recibido una nueva configuración.
- Conflictos y rechazos permanecen visibles. Para corregir un conflicto, consultar el ERP y crear otra propuesta; nunca se sobrescribe automáticamente el valor remoto.
- IndexedDB pasa de versión 22 a 23 conservando productos y añade `catalogEdits`/`catalogEditCache`. SQLite usa las colecciones de documentos existentes.

## Backend requerido

PR hermano CLIC-ERP: ruta `/api/sync/catalog-edits`, migración `pos_catalog_mutations`, bandera `POS_CATALOG_EDITS_ENABLED=true` y permiso `config.posCatalogEdits.enabled=true` en una terminal piloto. Consultar su documento del mismo nombre.

Antes de uso operativo hay que verificar la publicación CONFIG_PUSH_V2 del backend desplegado: la escritura aumenta versiones/invalida snapshots, pero no publica por sí sola. No se ha validado todavía el recorrido en dispositivos reales. No se ha desplegado ni generado APK.

No incluye precios por tarifa/overrides, altas/bajas, cambios de jerarquía o asignaciones, impuestos ni configuraciones operativas.

## Pruebas

- `npx tsx --test tests/catalogEditPersistence.test.ts tests/catalogEditQueue.test.ts tests/configPushV2Contract.test.ts tests/configPushV2Outbox.test.ts`.
- `npm run build`.
- ESLint focalizado sobre los archivos nuevos con reglas recomendadas TypeScript. El lint global del repositorio no arranca: falta la configuración plana exigida por ESLint 9, situación preexistente.

Smoke pendiente: habilitar piloto, editar precio/clasificación, comprobar escritura ERP, publicación y recepción en dos POS; repetir sin red, tras reinicio y ante conflicto. Mantener la función apagada hasta completar esa integración.
