# NC: conservar números al reintentar

El flujo estándar de devolución reservaba el NCF y la serie interna antes del commit financiero, sin una identidad durable del intento. Un fallo posterior podía consumir nuevos números al reintentar.

La corrección para SQLite Android:

- Identifica el intento por terminal/empresa/dispositivo/origen ERP, factura original y devoluciones ya confirmadas de esa factura. Una devolución parcial posterior tiene una identidad nueva.
- Guarda un recibo de reserva en la misma transacción nativa que avanza cada contador. Reapertura, pérdida de respuesta y concurrencia recuperan ese recibo.
- Conserva el documento preparado (fecha, ID, pagos, importes, serie y NCF) antes de intentar el commit financiero. El reintento usa ese documento exacto.
- Rechaza cambios de artículos, cantidades, condiciones, motivo o pagos mientras exista una reserva/documento pendiente del mismo intento. No asigna otro consecutivo silenciosamente.
- La ruta E34 con checkout utiliza una operación estable. Una reserva incierta no cae a la ruta alternativa. Un recibo de la ruta antigua tiene prioridad sobre una nueva disponibilidad de checkout.
- Los recibos y documentos preparados son inmutables. No se limpian junto con el historial visible.

No se retroceden contadores, no se reutilizan huecos anteriores y no se emiten notas de crédito reales durante las pruebas. Los intentos anteriores a esta corrección no tienen los nuevos recibos y no pueden recuperarse automáticamente por este mecanismo.

Alcance: devolución estándar local de App. El contrato independiente de artículos con formatos y las autoridades de devolución preparadas por ERP mantienen sus mecanismos existentes. En web sin `reserveFinancialNumbers`, el documento preparado se conserva, pero no se garantiza atomicidad del contador durante el intervalo anterior a ese guardado. No se añade reintento automático de operaciones bancarias.

Validación: `tests/refundNumberRetry.test.ts` ejecuta la clase SQLite nativa con fallos de escritura, pérdida de respuesta, reapertura y concurrencia; también ejecuta el callback real extraído de App con fallos al guardar el documento preparado y al persistir la devolución. Las suites existentes verifican atomicidad financiera, foto fiscal original, fuentes ERP y despacho fiscal. No se ha probado en un POS físico ni construido un APK para este cambio.

## Respuesta perdida después del commit financiero

En SQLite V3 se registra la confirmación del callback por separado. Antes de validar una nueva devolución se busca, por scope y factura original, un documento preparado sin confirmar cuya NC ya exista en historial financiero. Solo se recupera si coinciden la identidad financiera y el fingerprint nativo del par activo/historial. La recuperación no vuelve a afectar dinero, inventario ni contadores, y muestra el número recuperado. Esto evita interpretar el nuevo saldo pendiente de una devolución parcial como autorización para repetir la devolución anterior después de perder su respuesta. Un historial incompleto o contradictorio se detiene para conciliación.
