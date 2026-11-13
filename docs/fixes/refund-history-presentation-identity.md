# Devoluciones desde el historial: identidad de presentación

## Causa y alcance

En el emulador Retail con APK 1.1.638, la devolución del ticket TCK6000092
mostraba `SYNC_V3_REFUND_ORIGINAL_CHANGED`. `TicketHistory` añade la marca raíz
`_isArchived` a sus filas; esa marca llegaba a `readRefundOriginal` y se comparaba
como parte financiera contra la factura almacenada, aunque no cambiara la venta.

La lectura SQLite del emulador fue de sólo lectura. Sus copias activa e histórica
coincidían financieramente y diferían únicamente en la pertenencia al cierre Z.
La comparación del objeto presentado por el historial reprodujo el rechazo.

Se excluye exclusivamente `_isArchived` en la raíz de la comparación financiera
para devolución. No se omiten campos por prefijo ni marcas anidadas. Continúan
los controles de importes, pagos, artículos, identidad, estado comercial,
devoluciones relacionadas, pertenencia al cierre y actualización concurrente.
No se cambia la identidad de eventos, reservas, números ni el commit financiero.

También se corrige una dependencia ausente del fixture single-flight: ahora
inyecta `describeV3Error` real en el callback extraído, sin cambiar assertions.

## Validación y límites

- Base: `5630b9acd4fae60d38beda3d5955c1098951664d` (`origin/develop`).
- Código y pruebas: `5ffe22701047a276416d80bf9b57bd3aacdf7a7c`.
- Regresión nueva antes del arreglo: 3/5; después: 5/5.
- Revisión independiente: PASS; las seis pruebas single-flight también pasan.
- Matriz conservadora obligatoria: 256/256.
- Regresión ampliada: 102/103. Se conserva el fallo conocido de
  `articleFormatRefundEntries.test.ts`, caso de variante legacy, sin atribuirlo
  a este cambio ni modificarlo. La QA integral y el avance a release están
  bloqueados por ese fallo; las cifras anteriores no autorizan un APK.
- Compilación web/TypeScript y lint de archivos modificados: PASS.
- Pruebas aisladas comprueban cero escrituras durante la autorización, incluidos
  números, NC, pagos e inventario; no equivalen a una devolución productiva.
- El helper anterior es idéntico en develop y en la fuente del APK638. El
  consumidor RETURN completo del PR #998 no está integrado en esta base: este
  PR no lo incorpora ni lo sustituye. La validación de un overlay de la fuente638
  sólo acredita el guard de identidad, no el flujo fiscal completo.

El bloqueo físico de TCKS001000116 de Absolute permanece sin causa confirmada:
esa caja no estaba accesible. No se solicitó prepare, no se confirmó ninguna NC
ni se consumió otro número. No se modificaron esa factura ni las NC
E340000000003 y E340000000006. Sin APK, instalación o despliegue.

## Mejora de destino del reembolso: pendiente separado

El APK638 no incluye el selector de forma de reembolso ni anticipo/saldo a favor.
Su consumidor electrónico solicita los medios originales y conserva los
`paymentCommands` sellados por ERP, pero la pantalla no muestra esa selección.
El camino legacy aún usa su destino predeterminado anterior; esta corrección
del guard no lo cambia.

El borrador local de esa mejora no está integrado y se conservó intacto.
El contrato RETURN vigente no admite sustituir el pago original por un nuevo
anticipo/saldo a favor. Activarlo exige capacidad y preparación negociadas por
ERP que sellen reducción de deuda, reembolso externo y crédito del cliente;
la suma debe coincidir con la NC y cada efecto debe aplicarse una sola vez.
Un crédito no puede generar además salida de efectivo/banco ni asignarse a un
cliente anónimo. No se añade un endpoint ficticio ni se activa saldo local
sin su contrapartida ERP. Esta funcionalidad no se declara implementada.

## Procedimiento

El checkout principal tenía cambios ajenos y conflictos; se utilizó la worktree
aislada `/tmp/clic-pos-nc116`, creada desde develop actualizado, sin alterarlos.
Plan de `/root/refund_erp_contract` aprobado por `/root`; implementador,
reviewer, QA y sync-validator son sesiones independientes según WORKFLOW.
Los logs completos permanecen fuera del repositorio, sin copiar tokens ni
datos de configuración. Rollback: revertir los commits de esta tarea mediante PR.
