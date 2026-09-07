# Resolver numeración Z ocupada sin reemplazar un intento incierto

## Caso observado

La demo tenía serie ZS001 con nextNumber1/revision0, pero seis CASH_CLOSE_POSTED históricos APPLIED de la misma terminal y serie con códigos1,2,1,1,2,3. El intento actual falló CLOSE_COMMIT_NUMBER_USED y ERP comprobó rollback completo: cero membresías, peticiones y commits de ese intento. No se borró ningún registro ni se modificó el candidato congelado.

## Resolución

Ante NUMBER_USED la UI ofrece Corregir número ocupado. POS envía el request original congelado al endpoint autenticado `/close-preparations/:commandId/cancel-number-conflict` dentro de `{request: ...}`. ERP debe comprobar el resultado y la colisión bajo locks; un ACK COMMITTED se publica por la ruta habitual, nunca se cancela.

Una cancelación válida tiene version1,statusCANCELLED,reasonNUMBER_CONFLICT,proofId,scope,commandId,requestHash y serie reconciliada. POS valida IDs/hash/número ocupado y monotonía, guarda la constancia y los contadores locales en una sola transacción. El candidato y la preparación anteriores permanecen auditables. Solo después de esa constancia permite una revisión nueva. No modifica ventas, pagos, inventario ni cierres anteriores. ERP impide que un POST viejo alcance commit después de cancelar.

Los reintentos de cancelación conservan el request original. Una respuesta perdida no libera el candidato local. Fallo de SQLite revierte tanto constancia como contadores; un reinicio reintenta el mismo POST. Los contadores locales más altos se conservan con max().

## Pruebas

Pruebas SQLite de cancelación durable, reinicio, pérdida de ACK, rollback, bloqueo del POST viejo, conservación de ventas y diez respuestas alteradas/inválidas. La prueba HTTP/PG de cierre comprueba que un resultado COMMITTED retorna el ACK original y no produce cancelación. Suite operacional y recuperación:119pruebas aprobadas; build aprobado.

La corrección requiere contraparte ERP y APK actualizado. Ningún resultado de estas pruebas aisladas implica que el Z real haya sido emitido. El usuario conserva la confirmación final de su cierre.
