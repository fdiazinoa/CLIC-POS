# Checklist payments

Cada punto pertinente requiere SHA/manifest, entorno/rol/flags, esperado/observado y evidencia. No ejecutado = BLOCKED, no PASS.

- [ ] Métodos autorizados/ERP, efectivo/tarjeta sandbox/mixto/moneda/fracciones, vuelto/saldo.
- [ ] Crédito cliente/límite/deuda/supervisor correctos.
- [ ] PaymentIntent stable idempotency; timeout UNKNOWN requiere reconciliación sin segundo cargo.
- [ ] Doble click/cancel/declined/authorized commit falla/print falla sin doble cargo.
- [ ] Persistencia de pago enlazada a venta, artefactos integrados/ticket/cajón y sync PAYMENT_POSTED.
