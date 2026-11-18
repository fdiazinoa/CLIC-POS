# Recuperación conservadora de auditorías bloqueadas por contexto ERP

Las filas históricas de `posAuditEvents` e `invoiceAuditEvents` que quedaron en `BLOCKED_FUNCTIONAL` por `ERP_CONTEXT_MISSING` no se seleccionaban nuevamente aunque el contexto del ERP estuviera listo. El nuevo filtro permite que únicamente esas auditorías vuelvan al mismo transporte normal de envío.

## Alcance y conservación

- No hay requeue masivo, DELETE, restauración ni actualización de IDs, fechas originales, evento, factura o `idempotencyKey`. No se fuerza replay de ventas ni se alteran las colas financieras.
- El clasificador exige código top-level exacto con HTTP409 para errores estructurados actuales. Los campos HTTP tienen precedencia: un error400/403 no se libera por contener el texto409 en otro lugar.
- Los errores históricos solo se reconocen mediante el sobre completo anclado `Operational sync failed[ after re-auth]: 409 ... — <JSON válido>` con código exacto, o el código desnudo exacto. JSON truncado, códigos anidados, subcadenas, otros409 y otras colecciones siguen bloqueados. Razones contradictorias fallan cerrado.
- Si el ERP sigue devolviendo ese contexto faltante, se conserva la razón histórica y el bloqueo original, se guarda el último error y se deja la fila en `RETRY_WAIT` con `syncRetryAfter` a60 segundos. El filtro respeta ese plazo aun tras reiniciar el worker. No se modifica el intervalo general ni se crea un nuevo scheduler.
- El botón de reintento del monitor invoca el pipeline existente; no borra el cooldown ni cambia filas. Otras causas funcionales siguen sin habilitar reintento.

## ACK, idempotencia y autorización

El envío conserva `posAuditWireItem` y la validación existente: `eventId` original o `idempotencyKey` de factura, UUID de auditoría y disposición `RECORDED`. Una respuesta perdida, parcial o de otra identidad no confirma la fila local. El siguiente intento lleva la misma identidad y contenido; el receptor debe mantener su contrato idempotente.

Se conservan el flag `pos_operational_audit`, los destinos ERP_ACTIVE/POS_CLOUD_STAGING, ownership de terminal, exclusión de recuperación, offline y caja activa. Los guardas adicionales impiden enviar tras perder autorización/generación mientras se guarda SYNCING, y entre auditorías cuando una respuesta anterior pertenece a una generación ya invalidada. No hay cambios de privilegios ni bypass de readiness/scope del backend.

## Evidencia y límites

Las pruebas ejecutan el worker real mediante extracción AST, la proyección y validación de ACK reales de `pushAuditEvent`, y SQLite real para las filas persistidas. Los puertos de red/tiempo y un receptor idempotente simulado permiten comprobar dos auditorías históricas, conservación del wire, ACK perdido/inválido, replay, reinicio, cooldown exacto60s, conflictos de scope y guardas de offline/flag/terminal/caja/generación. Las pruebas IndexedDB y del adaptador nativo cubren persistencia sin cambiar documentos comerciales.

El receptor simulado no acredita una recepción real del ERP. Quedan pendientes el APK firmado, la prueba física de Master-01 y la verificación de sus dos eventos concretos tras un ACK del ERP. No se instala ni publica mediante esta implementación.
