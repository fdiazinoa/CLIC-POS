# Auditoría operativa del POS

## Productores corroborados y significado

| Productor POS | Antes | Integración |
| --- | --- | --- |
| `useSupervisorAuth.logAction` (descuento, anulación, devolución, cantidad, cobro y otras solicitudes de permiso) | Solo `config.auditLogs`; no envío ERP | Cola local `posAuditEvents` + `/api/sync/audit-events` |
| `InvoiceReviewService` con Outbox nativo activo | `INVOICE_AUDIT_RECORDED` / `INVOICE_REVIEW_FLAGGED` recibidos en inbox, sin bitácora ERP | Proyección del recibo durable hacia `erp_audit_events` |
| `InvoiceReviewService` sin Outbox | `invoiceAuditEvents` local pendiente sin drenaje | Drenaje por endpoint dedicado usando la misma identidad que inbox |

El hook acredita **autorización concedida**, incluida autoautorización. Ocurre antes del callback de negocio: nunca prueba descuento aplicado, devolución completada, anulación efectuada o apertura física de gaveta. La UI muestra «Autorizar descuento» / «Autorizar operación», el resultado `AUTHORIZED`, cajero/supervisor y valores declarados. Los correos distinguen solicitud, reenvío exitoso y fallo según el evento real del productor.

## Contrato 1

`POST /api/sync/audit-events` usa la autenticación estricta de terminal (`X-Sync-Token`, dispositivo y binding vigentes), contexto de tenant/empresa/sucursal del servidor y política comercial de canal. No acepta que actor POS sea una sesión Supabase ni que un tenant enviado por el cliente autorice otro scope. Hasta 20 registros / 64 KiB por solicitud. Ejemplo sintético:

```json
{"items":[{"schemaVersion":1,"kind":"AUTHORIZATION","event":{"id":"bc515f2c-fbf3-4c34-8978-5834591c52d5","timestamp":"2026-11-17T16:00:00Z","terminalId":"POS-1","actionType":"POS_DISCOUNT","actionDescription":"Autorizar descuento","cashierId":"local-cashier","cashierName":"Cajero","supervisorId":"local-supervisor","supervisorName":"Supervisor","ticketId":"T-1","originalValue":0,"newValue":10}}]}
```

`kind: INVOICE` recibe los campos seleccionados de `InvoiceAuditEvent`: `id`, `idempotencyKey`, `terminalId`, scopes opcionales que deben coincidir, `actorId/Name`, `authorizedById/Name`, `eventType`, `transactionId/DisplayId`, `occurredAt`, `reason`. No se copia la factura completa, `previousData/newData`, metadata libre, PIN, tokens ni hash simulado.

ACK válido, exclusivamente después de la persistencia y comprobación de replay:

```json
{"status":"success","results":[{"eventId":"bc515f2c-fbf3-4c34-8978-5834591c52d5","auditId":"4ae01a72-2211-51d8-8b30-d9599ab704ee","disposition":"RECORDED"}]}
```

El POS comprueba versión de su propio registro y ACK por ID estable/UUID de bitácora/`RECORDED`. HTTP 200, respuesta vacía o recibo genérico no permiten marcar la fila como enviada. El worker conserva reintentos y recupera `SYNCING` interrumpido. Un request puede persistir un prefijo antes de fallar; reenviar todos los IDs es seguro.

## Idempotencia, persistencia y aislamiento

- PK UUID determinista a partir de tenant + terminal canónica autenticada + clase + ID de origen; `idempotencyKey` de factura es compartido por rutas legacy/inbox.
- `INSERT ... ON CONFLICT DO NOTHING`, seguido de lectura por tenant/ID y comparación SHA-256 del contenido normalizado. Una entrega repetida no modifica la bitácora. Contenido cambiado con la misma identidad responde 409. Hora recibida y estados locales de sincronización no participan del digest.
- Inbox: antes de proyectar se relee la fila durable por ID/tenant/sucursal/terminal, se comprueba tipo y event ID y se compara el contenido normalizado con el request. Esto protege incluso duplicados anteriores a la primera proyección. Solo esos tipos de auditoría pueden marcarse `APPLIED` tras persistencia. No se invoca el aplicador comercial para auditar.
- `created_at` conserva la hora ocurrida; metadata conserva también la hora recibida, source ID, identidad POS declarada y terminal. `actor_user_id` queda NULL; nombres e IDs POS tienen namespace separado y jamás se asocian a `auth.users` por coincidencia de UUID. Lista, detalle, CSV, búsqueda y conteo de actores contemplan esa identidad.
- IndexedDB v28 agrega solamente `posAuditEvents` y conserva los stores existentes. SQLite usa su tabla genérica de documentos, sin migración de esquema comercial. La nueva cola es durable y no usa fallback silencioso a localStorage.
- Se guarda primero en la cola local. Si falla, se intenta conservar un log marcado en la configuración actual bajo escritura serializada; se muestra advertencia. Si ambos almacenamientos fallan, la advertencia no promete durabilidad. El background recupera solo backups fallidos, con inserción atómica `requireAbsent` y recibo en `syncMetadata`, sin degradar ACKs ni resucitar filas luego de su retención. El historial de factura no se elimina por agregar su transporte.
- Los envíos van al final del worker, ceden ante venta activa, y un fallo de auditoría no impide drenar las colas comerciales. No se espera HTTP para aprobar al operador.

## Rollout, flags y límites

1. Inspeccionar constraint actual `erp_audit_events_action_check`, comentario nativo si existe, privilegios de la función resumen, RLS y migraciones instaladas. La presencia del archivo no demuestra despliegue.
2. Aplicar por el procedimiento autorizado la migración `20261117204041_pos_operational_audit_actions.sql`, luego backend/UI ERP. Es aditiva: conserva todas las acciones previas, `RECEIVE`, acciones específicas del despliegue y actualiza la huella del comentario nativo. Usa lock timeout 5 s / statement timeout 30 s; si el esquema no tiene constraint esperado aborta la transacción. No hay backfill ni escrituras comerciales.
3. Después integrar/validar POS y preparar su actualización por el protocolo normal. Esta tarea **no genera ni instala APK ni ejecuta migraciones remotas**.
4. Backend `POS_OPERATIONAL_AUDIT_ENABLED=false` pausa la ingesta/proyección con 503. POS `VITE_POS_OPERATIONAL_AUDIT_ENABLED=false` o override local `pos_operational_audit=false` pausa transporte; conserva la cola y autorizaciones locales.
5. El endpoint debe estar desplegado antes del nuevo POS. ERP anterior/ausente conserva filas en reintento con ACK estricto. El transporte dedicado se usa solo en canales `ERP_ACTIVE` / `POS_CLOUD_STAGING`. **POS_MASTER sin forward compatible conserva pendientes sin tráfico al endpoint desconocido**; no se cambian reglas LAN ni Kotlin ni se salta SyncProfile. Validación de esa topología permanece pendiente.
6. Logs históricos `current-terminal`, sin terminal real o hash simulado no se atribuyen retroactivamente. No se reemiten automáticamente eventos de negocio para reconstruir auditoría. Una recuperación histórica de inbox debe ser selectiva por scope e IDs, proyectar la fila durable con este servicio y comprobar idempotencia, mediante tarea autorizada; no ejecutar el aplicador de ventas.

Rollback de aplicación: revertir PR por flujo protegido, conservando cola/histórico. La extensión SQL puede permanecer compatible con ERP anterior. No restaurar un constraint antiguo que rechace acciones ya almacenadas ni borrar historial para hacer rollback. Nunca desinstalar/limpiar datos del POS para revertir.

## Evidencia local y límites de verificación

Tests focalizados: PostgreSQL PGlite + HTTP real de la factory, persistencia/duplicados/concurrencia/ACK perdido/scopes/replay durable, drift de constraint; IndexedDB real simulado por `fake-indexeddb` con upgrade v27→v28 y preservación de documentos; adaptador Capacitor real contra SQLite/WASM con exportación/reapertura. No equivalen a hardware Android ni producción. Gates independientes y resultados finales viven en el expediente de tarea.

## Nombre del usuario afectado en eventos ERP

La acción de descatalogar un usuario POS emitía `entity_display = user.id` y omitía su nombre en la selección SQL. El productor ahora conserva nombre real (email disponible como fallback) y UUID técnico, sin cambiar la descatalogación ni permisos. Para eventos históricos `erp_pos_user` cuyo título está vacío o es UUID, la lectura compartida de lista/CSV prioriza nombre del snapshot y luego hace una única consulta por lote a `erp_pos_users.id` dentro del tenant. No reemplaza títulos históricos legibles, no modifica filas históricas ni interpreta el ID como `auth.users`; si el usuario ya no existe o no hay nombre disponible conserva el identificador original.
