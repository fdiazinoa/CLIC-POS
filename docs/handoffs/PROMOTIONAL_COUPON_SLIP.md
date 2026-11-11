# Coletilla de cupón por próxima compra

Solicitud: cupón nuevo por compra elegible de una promoción del ERP; QR del cupón, separado de la factura y con corte.

## Comportamiento

- `receiptConfig.printCouponSlip` es falso por defecto y es independiente del QR de factura.
- Diseño de ticket permite activarlo, guardarlo y ver un ejemplo rotulado SIN VALOR.
- Una factura aceptada conserva ese resultado aunque la emisión o impresión opcional del cupón falle.
- Sólo se solicita emisión para una venta TICKET COMPLETED persistida. Nunca desde preview, devolución, precuenta o prueba de impresora.
- La consulta sale después del trabajo crítico de impresión de factura; no modifica ni repite cobro, totales, transacción, outbox o identidad fiscal.
- El ERP decide elegibilidad y congela el resultado por venta. Cada reimpresión vuelve a validar online el mismo resultado y sus catálogos. No hay copia local que permita imprimir un cupón borrado por un reinicio autorizado del ERP.
- Con opción desactivada: cero consultas, cero emisiones y cero coletillas.
- Sin conexión, con origen pendiente o emisor no desplegado: factura normal y aviso explícito; no se inventa un QR local.
- Historial ofrece «Imprimir cupón» para reintentar únicamente la coletilla. No es necesario reimprimir factura ni cobrar otra vez.
- ESC/POS: factura y cada cupón tienen trabajos/contenido separado y su corte. Una copia del cupón aunque la factura tenga varias copias.
- Navegador: páginas separadas; apertura de diálogo cuando no hay agente de impresión. No se garantiza cortador físico desde navegador ni que el usuario confirme el diálogo.
- La fecha de un cupón reimpreso no se extiende. Una copia vencida lo indica.

## Contrato e integración

ERP: rama `feature/pos-next-purchase-coupon` desde clean-erp; POST `/api/sync/coupon-issuances` con `{transactionId}` solamente. Autenticación canónica de terminal/dispositivo y origen SALE_POSTED APPLIED.

La respuesta v1 coteja tenant, terminal y transacción e incluye referencia original, conjunto estable y datos de promoción, porcentaje, vigencia y código opaco. Se rechazan respuestas extrañas/incompletas, ámbito ajeno y cambios de identidad durante una petición. Solicitudes concurrentes comparten operación sólo dentro del mismo ámbito y credencial.

El cliente no inicia registro, migración de baseline, descarga de maestros ni refresco del catálogo para conseguir un cupón. La emisión económica depende del ERP; no sustituye sus reglas ni los controles de canje.

Requisitos previos al uso: desplegar el endpoint y aplicar su migración verificada; disponer de venta sincronizada y promoción soportada con horario/terminal/moneda/alcance correctos. Las promociones no soportadas producen aviso explícito, no un beneficio supuesto.

## Evidencia

- Pruebas nuevas: validación de contrato/ámbito, concurrencia, reprint online, rechazo tras eliminación del catálogo, errores recuperables, identidad financiera intacta, QR nativo del código emitido, cortes por cupón, HTML escapado y paginado.
- Orquestación real con transports de fixture: opción off sin llamadas, factura aceptada aunque emisión falle, retry sólo del cupón, devolución sin llamadas, fallback ordinario de navegador invoca impresión.
- Navegador con ReceiptDesigner real en fixture aislada: opción off inicial; Space activa; aparece ejemplo; Guardar conserva true en configuración. Evidencia `/Users/felixdiaz/.codex/visualizations/2026/10/30/01a18f39-4240-7f31-8ae8-507842c980aa/coupon-ticket-designer-qa.png`.
- Revisor independiente `/root/coupon_pos_review`: 46/46 pruebas y tsc, sin bloqueantes POS al digest 4f04b747ae6e2e75213e2398d60bad03da32794350d8d4862a72324cb089a09d.

## Límites y despliegue

No se generó APK, instaló dispositivo, habilitó opción real, emitió cupón real ni modificó producción.

Pendientes: integración desplegada de ERP, actualización del APK, impresora/cortador/escáner físicos y canario en Absolute. La validación sintética no equivale a esa prueba.

La arquitectura existente de canje con caché offline no garantiza una reserva atómica entre cajas desconectadas; esta tarea no la reescribe ni afirma single-use global. Tampoco introduce cancelación automática de cupones ya emitidos después de una devolución: requiere una política aparte. El ERP sí rechaza la primera emisión si la venta ya tiene una NC aplicada.

Rollback operativo: desactivar la opción y el endpoint; conservar ledger y códigos ya emitidos. No borrar ventas ni cupones ni cambiar identidades para volver a emitirlos.
