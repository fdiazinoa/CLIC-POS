# Cierre impreso compacto por servicio

Base: develop 6c6035e, incluye unión de mesas (#502) y autoescaneo (#503).

## Presentación

- En local / Para llevar / Delivery: una fila por modalidad y total por servicio.
- Impuestos y propina: consolidación por concepto y tasa, sin repetir importes
  bajo cada modalidad ni imprimir cada ticket para llevar/delivery.
- El detalle `serviceTypeTransactions` se conserva para consulta y auditoría.
- El texto aclara que el desglose no se suma nuevamente al total.
- Se aplica a las rutas HTML y ESC/POS de X/Z y a la preimpresión del cierre.

## Integridad

Se guarda `closeTaxSummary` en el reporte, usando exclusivamente importes
registrados (`taxBreakdown`, `taxAmount`, `serviceChargeAmount` y porcentaje de
propina del snapshot). No se multiplica el total por tasas actuales ni se
reescriben ventas, impuestos, pagos o arqueos. Propinas voluntarias no se mezclan
con propina legal. Devoluciones/anulaciones quedan fuera del resumen de ventas
por servicio, como antes.

Una propina configurada como impuesto se puede identificar por el nombre del
concepto en el desglose registrado aunque `serviceChargeAmount` sea cero.
No se presume propina 10% por el solo hecho de existir un cargo o una tasa 10%.
Si falta desglose histórico, se imprime "Impuestos sin desglose" o "Propina legal"
sin inventar una tasa. El detalle fiscal persistido de cierres antiguos se usa
cuando existe; nunca se consulta la configuración fiscal actual para reimprimir.

## QA

- npm ci y npm run build: aprobados.
- 244 pruebas aprobadas: suite operativa ampliada, lector, unión de mesas,
  cierres, formato HTML/ESC-POS y siete casos nuevos específicos.
- Actualizada la prueba del selector de servicio para comprobar pertenencia al
  bloqueo de modales sin exigir que sea la primera condición (nuevo lector).
- Vista previa HTML renderizada en Chrome a 80 mm e inspeccionada visualmente.
- git diff --check: aprobado.
- Lint sigue bloqueado por configuración ESLint9 ausente (preexistente).
- No se generó APK, no se instaló ni se creó un cierre o venta para esta prueba.
- Pendiente: impresión física desde el siguiente APK consolidado.
