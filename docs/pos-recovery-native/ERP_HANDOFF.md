# Respuesta del hilo POS para el ERP

Continúa exclusivamente en ERP sobre origin/clean-erp. Incorporar esta especificación es trabajo de contrato y pruebas de archivos; no autoriza endpoints, migraciones, producción ni edición del POS.

## Confirmado por POS

Base `4d5710875c352af367f2f82701e80102060dd68a`, sin cambios de los cálculos auditados respecto a `5993b1f`. Se entregan originales.schema.json, fixtures.json, results.json y verificadores. Ocho comparaciones pasan ejecutando helpers puros y bloques literales de cashExpected y openedAt; 21 proyecciones pasan schema. No hubo transacciones, UI completa, DB, HTTP ni restauración.

1. F01: adoptar `cashExpected={USD:10,DOP:-50}`; equivalente convertido DOP 550 separado. La validación monetaria no certifica impuestos/líneas del fixture ERP.
2. F02: resultado literal `{}`; fallback UI 0; collectionsTotal 100; openedAt hora actual del cierre si no hay ventas/movimientos. No corregir abonos silenciosamente.
3. F04: un pago CASH +50 produce caja +50 aun en REFUND. Es diagnóstico, no flujo de devolución aprobado. Fixture normal: REFUND/status REFUNDED,total positivo,pago STORE_CREDIT. Con fondo 1000 → caja 1000, retornos 50. Alternativas observadas: CARD con gatewayTransactionType REFUND o VOID, mismo resultado de efectivo. No proponer 950 ni invertir signos en importación.
4. Anticipo agenda: original es Collection con bookingActivityId, no objeto appointmentId reducido. En cálculo actual participa como collection, no como venta ni saldo agregado.
5. Line.id es producto; cartId identifica línea. El fixture line-1/productId no es equivalente sin mapeo comprobado. Preservar ambos IDs originales.
6. El Z necesita mapas cashExpected/cashCounted/cashDiscrepancy y campos nativos de cierre. Los agregados declaredTotals/systemTotals no sustituyen esos datos. ACK perdido conserva original recibido, pero una referencia incompleta no se vuelve un Z nativo completo con defaults.

## Qué incorporar al contrato

Separar envelope de proyección operacional por tipo. Los schemas adjuntos son **mínimos propuestos**, más estrictos que algunas versiones legacy y menos extensos que los tipos Product completos. No exigen recuperar maestros eliminados por el emisor para copiar el documento. additionalProperties=true obliga a preservar propiedades desconocidas; no omitirlas.

No etiquetar como versión nativa certificada un registro que solo pasa el envelope. Original vacío o falta de IDs, moneda histórica aplicable, campos monetarios/relaciones críticos produce diagnóstico de aptitud. Legado se conserva como evidencia; no inventar usuario, moneda, cartId, fecha o revisión. Original completo para copia tampoco certifica membresía, fiscal ni permiso de cierre.

La normalización POS saliente proyecta pagos y puede generar ID/hora faltantes. El restaurador no la ejecutará. Datos de pasarela no presentes no pueden recuperarse para reimpresión integrada desde el subconjunto recibido.

## Respuesta requerida del ERP

- Confirmar cuáles campos de estas proyecciones conserva hoy por canal y cuáles necesitan respaldo nuevo. Confirmar relaciones y ámbito histórico por original, no desde maestro vigente.
- Definir originalSchemaVersion/versionado y política de carencias: copy/calculation/print por separado; no inventar revisión para legacy.
- Incorporar fixtures corregidos sin confundir los originales artificiales POS con prueba de respaldo real. Añadir su propio mapping/payment-reference dedup y verificar cero efectos comerciales en futuras pruebas aisladas.
- Mantener pendientes esquemas de VOID comercial independiente y wallet completo por canal; no inferirlos del objeto reducido ni de CARD_VOID.
- Mantener separada aceptación del Z: manifiesto, sello final, revisiones concurrentes, reservas y política offline siguen sin acuerdo. Descargar no habilita cierre.

No se necesita cambiar el cálculo actual del POS para aprobar la especificación monetaria observada. Si se desea corregir cashExpected de abonos o reembolso CASH, será una tarea aparte y versionada. No declarar lista la recuperación hasta que pertenencia, cobertura y cierre estén validados de extremo a extremo.
