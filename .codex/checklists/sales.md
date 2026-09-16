# Checklist sales

Cada punto pertinente requiere SHA/manifest, entorno/rol/flags, esperado/observado y evidencia. No ejecutado = BLOCKED, no PASS.

- [ ] Artículo/scan/cartId sin duplicados; cantidades/precios/variante/modificadores/kit/tarifa/almacén correctos.
- [ ] Impuestos incluidos/excluidos/exento/servicio, descuentos línea/global/promos/permisos, redondeo/totales.
- [ ] Venta local/history/ledger/tracking/deuda/secuencia/NCF consistentes; legacy/durable por flags.
- [ ] Cobro/ticket/persistencia/impresión/sync solo un efecto tras reintentar/restart/error.
- [ ] Compare transacción local y documento ERP, no solo status HTTP.
