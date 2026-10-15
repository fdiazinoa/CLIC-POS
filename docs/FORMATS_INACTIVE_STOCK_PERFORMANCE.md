# Índice local para stock con formatos inactivos

Base de esta tarea: `937edd448ce1aec59a6a4ecdb3c39658dfa01f39`.
La referencia de performance original sigue siendo `71e8043c4c92b403bcc57c539af868b28f208a1c`;
el merge937 no sustituye esa referencia ni borra el fallo de659.

La migración nativa añade únicamente `idx_documents_v3_inventory_delta_cover`,
un índice parcial con identidad V3/artículo/warehouse y la expresión histórica
`COALESCE(qtyIn,0)-COALESCE(qtyOut,0)`. El índice anterior se conserva.
SQLite mantiene sus entradas dentro de las transacciones existentes. El SQL de
SUM/CASE, el detector global de autoridad seleccionada, las APIs, el proxy de
propiedad y las validaciones de scope/autorización/reservas permanecen iguales.
No se añade caché ni se activa formatos o readiness.

`tests/formatsInactiveStockIndex.test.ts` ejecuta SQLite real y el adaptador nativo
sobre puente host: migración de archivo preindex/reopen/idempotencia, EXPLAIN del
SQL real sin forzar planner, escrituras/metadata/rollback, respuesta COMMIT perdida,
fallos de creación y protección física existente. Compara el SUM histórico sin
nuevo índice con el lector candidato para fracciones de seis decimales, cantidades
grandes con cancelación, null/missing y entradas repetidas; comprueba resultado
binario exacto y decisiones de disponibilidad, sin redondear código productivo.
También demuestra atomicidad de un CREATE INDEX fallido sin transacción envolvente.

```sh
./node_modules/.bin/tsx --test tests/formatsInactiveStockIndex.test.ts
```

Estas verificaciones no son PERFORMANCE PASS ni prueba Android/plugin/WebView.
Después de revisión/QA independientes se requieren mediciones comparables contra
71e y937, conservando todas las muestras y el umbral5% previo. Deben medirse además
costes de migración/startup, escrituras y tamaño de archivo/índice; no se infieren
presupuestos UI/dispositivo desde tiempos host. Si cambia una cantidad/decisión,
el planner no usa el índice o el presupuesto sigue fallando, se vuelve a análisis.
No se altera SUM ni se introducen tolerancias para lograr aprobación.

La retirada de código deja un índice aditivo inocuo; no elimina datos ni historial.
No se autoriza DROP de índices existentes, rebuild de DB operativa, APK, instalación,
ERP/SQL remoto, flags reales, merge ni despliegue. Los gates requeridos, incluido
dispositivo cuando no haya entorno autorizado, conservan su estado pendiente/bloqueado.
