# Checklist sync

Cada punto pertinente requiere esperado/observado y enlace a evidencia para candidate SHA. N/A solo si analista propone y validador independiente justifica ausencia de impacto; nunca por falta de entorno. Checklist completada no sustituye ejecución.

- [ ] Identificar flags/receiver/topología: legacy vs durable, MASTER vs cliente, ERP conectado.
- [ ] POS → ERP venta/pago/inventario/cash/Z: ID/eventId estable, documento ERP y efectos únicos.
- [ ] ACK por evento: RECEIVED/STAGED/master no se confunde con APPLIED_ERP; 200 no prueba apply.
- [ ] ERP → POS catálogo/precio/impuestos/config/usuarios: snapshots/deltas/cursors/versions y scopes.
- [ ] Edición local pendiente no se pierde/rebota con full pull/delta/concurrencia.
- [ ] Realtime scope tenant/device/terminal, autorización private/public y revocación.
- [ ] Hint dup/perdido/reconnect dispara reconciliación segura; polling degrada con backoff/jitter.
- [ ] Heartbeat avanza en activo/idle; edad/counters y drain cumplen presupuesto.
- [ ] Retry timeout/429/5xx/auth, missing batch result y rechazo final sin bucle ni pérdida.
- [ ] Lease expirado tras crash, doble worker y batch límite/event ordering seguros.
- [ ] Reinicio después de apply antes de ack no duplica stock/deuda/cierre/cobro.
- [ ] Capturar counters/tráfico/last_erp_applied/pending/oldest_age y verificar ERP receptor de prueba.
