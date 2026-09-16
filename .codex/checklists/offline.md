# Checklist offline

Cada punto pertinente requiere esperado/observado y enlace a evidencia para candidate SHA. N/A solo si analista propone y validador independiente justifica ausencia de impacto; nunca por falta de entorno. Checklist completada no sustituye ejecución.

- [ ] Crear operación solo en dataset/terminal de prueba y registrar política offline por rol.
- [ ] Persistir y reabrir después de restart; datos/pendientes/secuencias/cobro intactos.
- [ ] Web IndexedDB/fallback y Android SQLite probados según impacto; storage cuota/error soportados.
- [ ] Corte de red antes/durante/después de envío y antes de ACK.
- [ ] Legacy escrituras parciales y durable atomicidad/rollback verificados por separado.
- [ ] Outbox/queues preservan eventId, attempts/retryAt/errores y recuperan lease.
- [ ] Reconectar drena sin doble efecto local/ERP; medir tiempo de drain y pendientes restantes.
- [ ] Recepción/conteo localApplied no vuelve a sumar inventario; conflictos no se sobrescriben sin política.
- [ ] Mesas cliente con master inaccesible mantiene restricciones y no pierde ticket.
- [ ] Auth/tokens/tenant/session y recovery después de background conservan reglas.
- [ ] Tarjeta/fiscal/cloud que requieren red conservan pending/error/política explícita.
- [ ] Nunca seed/reset/clear/uninstall/downgrade datos operativos para obtener evidencia verde.
