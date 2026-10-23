# Reserva fiscal offline V1 — candidato aditivo

La sesión de transporte del ERP y su caché V2 de cinco minutos no autorizan esta reserva. El ERP debe habilitar explícitamente `OFFLINE_FISCAL_LEASE_V1` para empresa/terminal, con la migración y API complementarias. Backend antiguo/default-OFF conserva V2; el POS no convierte permisos V2 vencidos en permisos offline nuevos.

Contrato inicial: hasta siete días, 1024 intentos por reserva como política predeterminada del ERP, páginas de hasta 16 permisos y máximo técnico de 4096. SQLite conserva lease, permisos, reloj observado y vinculación sin guardar otra copia del bearer. Preparar páginas ocurre en segundo plano; el cobro utiliza exclusivamente la reserva ya guardada, sin esperar HTTP. La pantalla de pago muestra la cantidad realmente descargada disponible y su vencimiento. Se necesita descargar una reserva nueva online antes de poder usarla.

## Alcance de cobro

Efectivo, Android SQLite, factura nueva positiva y caja Master local. Incluye cobro completo de una cuenta de mesa `parkedTickets`; excluye clientes LAN desconectados del Master, formatos especiales, devoluciones/reservas recuperadas y fracciones. Los proveedores de tarjeta conservan su propia autorización. Una venta directa con cargo de servicio adicional permanece fuera de este nuevo perfil; la mesa admite el componente legal explícito del 10% y la clasificación SERVICE_CHARGE ya recibida, sin sumar dos veces.

`fiscalSaleContext` de mesa fija cuenta, mesa y SHA-256 del JSON durable original. No acredita por sí solo una cuenta remota propiedad del ERP. El escritor conserva comparación exacta del original, pertenencia, cierre único `v3TicketSettlements` y guardas de inventario/precio/impuesto. La factura recién nacida recibe `fiscalOfflineLeaseId`, ambiente y autoridad reales; los documentos históricos no se completan ni reescriben.

Consumo de permiso, venta/historial y Outbox usan la misma transacción financiera nativa que el cierre de cuenta. Las rutas de numeración existentes permanecen vigentes. PREPARED vencido no inicia pago. EFFECT_POSSIBLE sólo reconcilia la misma identidad y un efecto registrado antes del vencimiento; no reasigna un permiso ni crea otro cobro.

Cancelar/editar un PREPARED sin efectos puede abandonar su puntero local mediante CAS y examen de efectos/intentos/recuperación. Se conserva una prueba append-only y el permiso reservado queda quemado, sin volver al pool. Guardas SQL bloquean posteriores escritores, colas y promociones de recuperación con sus identidades. Un intento ambiguo o pagado nunca se abandona por este camino. El cupo cuenta intentos reservados, incluidos los abandonados sin efectos. Recuperar conexión no garantiza reponer esos permisos quemados antes del vencimiento: el ERP decide cuándo emitir una nueva reserva.

## Reloj y revocación

La primera observación autenticada fija el desfase servidor/dispositivo por lease; rellenar páginas no recalcula ni congela ese reloj. El máximo reloj local observado es durable y los retrocesos se bloquean. La fecha original del nuevo intento se fija usando ese desfase. Esto protege errores de reloj dentro del modelo de confianza del dispositivo actual, sin afirmar que existe un reloj criptográfico en hardware.

Cambio local de vinculación/empresa/emisor/ambiente y revocación explícita observada dejan tombstones irreversibles. Un timeout/red caída no revoca. La rotación de sesión no cambia la autoridad offline. NEEDS_REAUTH por sesión vencida y token de sincronización ausente pueden usar únicamente un runtime V3 READY ya guardado, con owner y anchors de catálogo/inventario coincidentes y reserva fiscal nativa validada. No habilitan descargas ni cambian el transporte autenticado. Los cambios de precio/almacén conservan su fence V3 independiente; no alteran la identidad de la reserva fiscal. Una revocación remota no conocida durante una desconexión sólo puede hacerse efectiva al observarse o al agotar/vencer la reserva. El ERP conserva su validación vigente al recibir y emitir posteriormente.

## Compatibilidad y comprobación

ERP publica `/fiscal/workflow/v2/offline-lease/capability` y `/permits`. Permisos V2 añaden `leaseId`; el birth V2 mantiene su forma previa. La API y SQL del ERP deben validar autoridad durable, cuenta única y nacimiento dentro de vigencia aunque la entrega sea posterior. El worker y su fence de emisión siguen siendo independientes del cobro local.

Pruebas locales: `tests/offlineFiscalLease.test.ts`, fiscal V2 nativo/capacidad, validadores V3 y suites críticas del workflow. Las pruebas SQLite usan datos sintéticos; una factura sintética de 555 + 99.90 ITBIS + 55.50 servicio = 710.40 comprueba la suma, no describe un documento operativo extraído del usuario. El callback real extraído de POSInterface se prueba con vaciado/flush de cuenta, dos mesas secuenciales, limpieza tras ACK, recuperación del recibo de la primera y fence conservado tras efecto posible. La prueba del adaptador usa NCF sintético ya asignado; no sustituye QA independiente de reserva de numeración ni humo físico.

Este documento no acredita release, despliegue, aprobación fiscal normativa, instalación de APK o prueba de una venta real. El nuevo webhook de MSeller complementa el seguimiento asíncrono y no es un requisito para confirmar un cobro local.
