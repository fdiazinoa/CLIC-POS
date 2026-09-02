# Rangos numéricos offline de maestros

## Alcance

El POS consume `resolved.master_number_ranges` del ERP para CUSTOMER, SUPPLIER e ITEM. Los rangos no usan tablas ni contadores fiscales.

- SQLite Android: tabla independiente `master_number_ranges`.
- Web: store IndexedDB `masterNumberRanges` (schema 21).
- El rango se vincula localmente al UUID canónico del contexto validado de terminal.
- Cursor monotónico, conservación de rangos agotados/revocados y bloqueo de rangos rechazados por pertenecer a otra terminal.
- Código `PREFIX-NUMBER`, UUID técnico separado y metadatos de origen POS.
- Asignación, avance y documento se confirman en una sola transacción. Para clientes, también se confirma la mutación de sincronización en esa transacción.
- Repetir la creación con el mismo UUID devuelve el documento existente sin consumir otro número.
- Las actualizaciones de maestros existentes no pasan por el asignador.

## Sincronización de progreso

Se reutiliza el cliente operativo `ApiSyncAdapter`, sus credenciales y `X-Sync-Token`.

`POST /api/sync/terminals/{terminalUuid}/master-number-ranges/progress`

El progreso solo sale por un destino `ERP_ACTIVE`; no se envía el endpoint nuevo al servidor LAN Master. Se conserva pendiente si no hay canal ERP o si el envío falla.

Antes del progreso se exige una confirmación real del transporte del maestro. Las confirmaciones se guardan idempotentemente en `masterNumberSyncReceipts`. Solo se informa el tramo consecutivo confirmado, nunca un número que salte un maestro aún no sincronizado. Se envía un rango por solicitud para aislar un rechazo de propiedad. El código ERP `MASTER_NUMBER_RANGE_SCOPE_MISMATCH` bloquea ese rango y solicita una configuración remota nueva.

## Dependencias de integración pendientes

El PR ERP [#1968](https://github.com/fdiazinoa/CLIC-ERP/pull/1968), revisado durante esta implementación, añade rangos, reporte de progreso y metadatos/códigos de clientes. En el POS actual existe el transporte `/customers/upsert`, pero no se encontró un contrato equivalente de altas ERP para proveedores/artículos.

Por seguridad:

1. CUSTOMER queda conectado a su cola existente; el ACK habilita el progreso.
2. SUPPLIER e ITEM se crean y numeran localmente, pero su progreso permanece pendiente hasta conectar un transporte de altas confirmado por ERP. No se inventaron endpoints.
3. Para clientes que operan exclusivamente contra `POS_MASTER`, falta un contrato de confirmación/relay de ERP hacia el cliente antes de reportar su rango. No se confunde un ACK del Master LAN con un ACK ERP.

Estos puntos deben cerrarse antes de considerar la funcionalidad completa para los tres tipos y ambas topologías. No generar un release de esta rama como si el smoke ERP completo estuviera aprobado.

## Interfaz

Configuración → Sistema y Auditoría → **Rangos de maestros**. Vista de solo lectura con tipo, límites, próximo código, disponibles, porcentaje consumido, estado y alerta al quedar 20% o menos. No permite editar rangos ni cursores.

## Validación

- Pruebas puras y contractuales: `tests/masterNumberRanges.test.ts`.
- Pruebas sobre SQLite real usando el mismo adaptador Android con un puente de prueba: `tests/masterNumberRangeSqlite.test.ts`.
- CONFIG_PUSH_V2 con rango nuevo y snapshot antiguo: `tests/configPushV2Contract.test.ts`.
- Concurrencia de 30 altas, mismo UUID repetido, rollback de disco, cierre/reapertura de base, agotamiento, propiedad de terminal y ACK monotónico.
- Suite focalizada de rangos, CONFIG_PUSH_V2, recuperación, ventas, fiscalidad, impuestos y sincronización: 96 pruebas aprobadas.
- `npm run build` ejecutado.
- Lint bloqueado por la configuración existente: ESLint 9 no encuentra `eslint.config.js/mjs/cjs`.

El smoke con ERP real (asignar rango, desconectar POS, crear, reiniciar, reconectar y comprobar ERP) queda pendiente de integración de contratos y de ejecutar esta versión en una terminal de QA. Las pruebas SQLite no se presentan como QA del APK ni del ERP desplegado.
