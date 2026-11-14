# Consumidor POS de liquidación RETURN/E34 v1

Contrato de referencia: ERP PR #2516, commit
`986c0ceae8ef625d2f681cfa049a779193257bc3`,
[`pos-return-settlement-v1-contract.md`](https://github.com/fdiazinoa/CLIC-ERP/blob/986c0ceae8ef625d2f681cfa049a779193257bc3/docs/development/pos-return-settlement-v1-contract.md).

## Dependencias y alcance

La rama nace de develop `6e5ac554`. Esa base todavía no incluía el consumidor
RETURN del PR #998 que se utilizó en APK638. El merge de `03eccd72` incorpora
ese trabajo existente sin los cambios posteriores de versión Android; preserva
el correo fiscal firmado y la corrección del marcador de historial de #1001.
No se desarrolló sobre el borrador local de reembolsos ni se modificó ese trabajo.

## Reglas del consumidor

- El selector requiere capability autenticada, preparada y habilitada. El valor
  inicial es ORIGINAL_PAYMENT; CUSTOMER_CREDIT corresponde al cliente original
  identificado, nunca a otro cliente escogido en la devolución.
- La nueva preparación envía `payments: []` y `settlement` versión 1. Importes,
  medios y movimientos proceden del snapshot ERP; no se recalculan en POS.
- Se conserva la preparación completa y su prueba SHA-256 sobre los bytes UTF-8
  exactos. El contrato fiscal de evento mantiene sus seis campos, sin ampliarlo.
- Deuda reducida, reembolso externo y crédito de cliente son destinos distintos.
  El crédito no produce PAYMENT_POSTED, depósito wallet local ni salida de caja.
- Un intento recuperado conserva sus bytes, operación, checkout, transacción,
  eventos y número. Las preparaciones legacy guardadas no se convierten al nuevo
  esquema. No se cambia de destino automáticamente después de preparar.
- La aplicación de saldo usa el endpoint autenticado `/return/credit/apply`
  contra una FACTURA ERP existente. Su comando se guarda antes del POST y el
  recibo antes del refresco de proyección. No modifica la venta congelada ni
  añade eventos de pago o débito local por ese consumo.
- La impresión presenta la autorización guardada: deuda aplicada, medios e
  importes reembolsados o saldo a favor sin entrega de efectivo/banco. Los
  fundingPayments no se presentan como dinero entregado. La firma y el QR fiscal
  mantienen sus comprobaciones existentes; sólo el worker ERP emite E34.

## Despliegue y límites

El contrato requiere su migración ERP, cuentas contables válidas y ambos flags
RETURN/SETTLEMENT habilitados. Que el PR ERP esté merged no acredita que esas
condiciones estén desplegadas. El POS conserva pendientes ante retención o falta
de conexión y no inventa capacidad, identidad ERP ni autoridad fiscal.

Esta tarea entrega código y PR. No genera, instala ni publica APK, cambia la
versión Android o activa producción. No se modifican ni reintentan documentos
reales; en particular quedan intactas E340000000003, E340000000006 y
TCKS001000116. Las pruebas utilizan únicamente datos y servicios aislados.

## Validación

Candidato funcional: `89512ba341cbe82670e529a2cea263953d750b65`.
Revisión independiente: PASS, incluido el cierre de la selección E44/E45.
QA independiente: 256/256 pruebas afectadas, 293/293 comprobaciones transversales,
compilación web/TypeScript y nueve comprobaciones del componente React en Chrome.
Lint de archivos modificados: cero errores y un warning previo de escape.

Integración aislada con el ERP986c: cinco escenarios aprobados usando PostgreSQL,
HTTP loopback, SQLite de archivo y proveedor simulado. Incluye pagos mixtos,
devolución parcial con deuda, crédito de100 y consumo de70 sobre factura de150,
respuesta perdida y reapertura: saldo30/deuda80, un recibo/asiento, comandos
idénticos, sin débito local ni NC o consecutivo adicionales. No equivale a un
reembolso bancario real ni a aceptación DGII productiva.

Límites conservados al cerrar por petición del usuario de detener pruebas
adicionales: Android no ejecutó el bundle candidato; el harness abortó en el
preflight de transporte/espera del PID, antes de casos financieros nativos.
El análisis de rendimiento en Chrome obtuvo p95 menor de18ms, pero observó
incrementos relativos por encima de5% (+1.1ms al abrir y +1.6ms al seleccionar
todo); no se completó su investigación. No se declaran esos gates aprobados.
No hay aprobación de APK, instalación o producción.

El consumo exige una identidad de FACTURA ERP recibida por el status autenticado;
si falta, se retiene. Nunca se sustituye por el UUID local del ticket. Tras el
ACK de una NC, una nueva confirmación sobre la frontera actualizada de cantidades
representa otra devolución parcial; no se presenta como reintento de la anterior.
Las preparaciones y operaciones pendientes conservan sus propias identidades.

Informes externos de las sesiones independientes: /tmp/return-settlement-review.md,
/tmp/return-settlement-qa.md, /tmp/return-settlement-sync.md y
/tmp/return-settlement-performance.md. No contienen credenciales productivas.
