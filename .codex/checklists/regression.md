# Checklist regression

Cada punto pertinente requiere esperado/observado y enlace a evidencia para candidate SHA. N/A solo si analista propone y validador independiente justifica ausencia de impacto; nunca por falta de entorno. Checklist completada no sustituye ejecución.

- [ ] Matriz transitiva de consumidores revisada contra diff y imports/events, no solo rutas cambiadas.
- [ ] Web y Android nativo diferenciados; master ERP, master LOCAL_ONLY, cliente y order taker pertinentes.
- [ ] Dataset representativo: catálogo/historial grandes, impuestos/variantes/kits y transacciones pendientes.
- [ ] No pérdida ni duplicación de venta/pago/ledger/deuda/series/NCF/parked ticket/Z.
- [ ] Estado React/DB/cache converge tras pull, restart, remount y background/foreground.
- [ ] Mesas libera lock al salir/cancelar y no pierde líneas al cambiar/merge.
- [ ] Roles impiden X/Z/cobros/ediciones cuando corresponde; tenant/terminal scope conservado.
- [ ] Tests de lógica/adaptadores separados de contratos textuales y E2E real.
- [ ] Resultado baseline y candidate comparado; fallos preexistentes registrados sin falsos PASS.
- [ ] No regresión funcional por mejora de performance; no desactivación de sincronización.
- [ ] Evidencias del SHA exacto y validador independiente de todos los autores.
