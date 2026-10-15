# Índice local para stock con formatos inactivos

Base de esta tarea: `937edd448ce1aec59a6a4ecdb3c39658dfa01f39`.
La referencia de performance original sigue siendo `71e8043c4c92b403bcc57c539af868b28f208a1c`;
el merge937 no sustituye esa referencia ni borra el fallo de659.

La migración nativa añade únicamente `idx_documents_v3_inventory_delta_cover`,
un índice parcial con identidad V3/artículo/warehouse y la expresión histórica
`COALESCE(qtyIn,0)-COALESCE(qtyOut,0)`. El índice anterior se conserva.
SQLite mantiene sus entradas dentro de las transacciones existentes. Los cuatro
lectores de cantidades ordenan las filas por rowid antes de SUM: single y batch
del store, precondición financiera ordinaria y acumulado entero BASE4. Esto conserva
el orden histórico ante cancelaciones flotantes y desbordamientos intermedios int64.
Los tres agregados flotantes usan el índice covering; únicamente su error exacto
de índice inexistente permite reintentar el mismo SQL ordenado sin hint. BASE4
ordena los documentos originales, manteniendo MAX de invalidez y ROUND/CAST por
operando. El detector global de autoridad seleccionada, las APIs, el proxy de
propiedad y las validaciones de scope/autorización/reservas permanecen iguales.
No se añade caché ni se activa formatos o readiness.

`tests/formatsInactiveStockIndex.test.ts` ejecuta SQLite real y el adaptador nativo
sobre puente host: migración de archivo preindex/reopen/idempotencia, EXPLAIN del
SQL real y orden anterior a la agregación, escrituras/metadata/rollback, respuesta COMMIT perdida,
fallos de creación y protección física existente. Compara el SUM histórico sin
nuevo índice con el lector candidato para fracciones de seis decimales, cantidades
grandes con cancelación, null/missing y entradas repetidas; comprueba resultado
binario exacto y decisiones de disponibilidad, sin redondear código productivo.
También demuestra atomicidad de un CREATE INDEX fallido sin transacción envolvente.

`tests/formatsInactiveStockOrderedSum.test.ts` conserva los dos contraejemplos
de revisión, 128 permutaciones, decisiones nativas reales y proyecciones de sesión,
batch sparse/dedupe de 100 IDs en una sentencia (más su lectura de autoridad),
combinaciones históricas de tabla/índice, errores que deben propagarse y autoridad
seleccionada. BASE4 incluye 20.000 operandos alternados válidos con ambos signos
iniciales, índice presente/ausente, límite nativo 137 frente a 137.0001, operandos
inválidos y rechazo del desbordamiento real en el orden original. Los oráculos
locales usan SQL histórico sin el nuevo índice; la revisión independiente conserva
sus ejecuciones del código original71e. No sustituyen esa evidencia independiente.

```sh
./node_modules/.bin/tsx --test tests/formatsInactiveStockIndex.test.ts tests/formatsInactiveStockOrderedSum.test.ts tests/articleFormatsInventorySingleRead.test.ts
```

Estas verificaciones no son PERFORMANCE PASS ni prueba Android/plugin/WebView.
Después de revisión/QA independientes se requieren mediciones comparables contra
71e y937, conservando todas las muestras y el umbral5% previo. Deben medirse además
costes de migración/startup, escrituras y tamaño de archivo/índice; no se infieren
presupuestos UI/dispositivo desde tiempos host. Si cambia una cantidad/decisión,
el planner no usa el índice o el presupuesto sigue fallando, se vuelve a análisis.
No se cambia la aritmética de SUM ni se introducen tolerancias para lograr aprobación.
El candidato459 falló revisión por reordenamiento y se conserva como evidencia;
la corrección posterior requiere nueva revisión, QA y medición independientes.
El motor host corroborado en esta corrección es SQLite3.51.2; la mención inicial
a3.51.3 en el reporte externo de459 era una errata, conservada transparentemente.

Mientras exista el índice covering deben mantenerse los cuatro lectores ordenados.
Revertir únicamente el código a937 conservando ese índice reintroduce cambios de
decisiones de venta y desbordamientos intermedios. Su retirada requiere una futura
migración explícita, autorizada y validada; esta tarea no ejecuta esa migración.
No se autoriza DROP de índices existentes, rebuild de DB operativa, APK, instalación,
ERP/SQL remoto, flags reales, merge ni despliegue. Los gates requeridos, incluido
dispositivo cuando no haya entorno autorizado, conservan su estado pendiente/bloqueado.
