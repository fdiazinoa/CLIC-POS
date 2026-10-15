# Ciclo de vida del índice físico de formatos

Base937edd448ce1aec59a6a4ecdb3c39658dfa01f39. El índice
`article_format_inventory_document_pool` sirve al guard de efectos físicos;
no pertenece a la migración financiera inactiva. La migración WIRE deja de crearlo.
El índice V3 original y todas las consultas y cantidades permanecen iguales.
No se introduce covering, caché ni ordenación nueva de SUM.

Un helper común asume una transacción ya poseída. El init nativo toma la cola una
vez y usa su transacción privada; posting.migrate toma runFinancial una vez tras
el esquema; el primer binding confiable crea y valida el índice antes de guardar
binding/state en su misma transacción. Nunca se invoca el runFinancial público
desde una cola ya adquirida ni executeSchema dentro de la transacción financiera.
Sólo las dos sentencias fijas CREATE/DROP de este índice se despachan por
execute(false): el plugin Android Database.execute usa execSQL y evita un BEGIN
anidado cuando transaction=false. La prueba host no sustituye prueba física Android.

El init anterior a WIRE admite su tabla ausente explícitamente; la migración
posterior a WIRE la exige. Todas las tablas básicas/de inventario son obligatorias.
Cualquier fila global en binding/state/originals/effects/links/balances/absorptions/
authorities/history/staging, Outbox, wire o base_movements conserva/asegura el
índice, incluso ACKED, sin selección o de otro scope. Sólo ausencia completa de
uso permite retirar el índice existente validado. Identidad incluye SQL con
literales intactos, tabla, orden, collation, no unique y predicate parcial.
Errores de identidad/schema/bridge no equivalen a vacío y conservan el estado
previo mediante rollback. Una respuesta COMMIT perdida rechaza y se reconcilia
por reopen, sin compensar stock ni borrar datos/historial.

Pruebas: `tests/formatsInactivePoolIndex.test.ts` usa SQLite real y adaptador
nativo host: init/migrate, WIRE opcional, retención por cada tabla, binding/cleanup
con fallos y commit perdido, concurrencia/otro writer, reinicio de archivo activo89,
EXPLAIN del guard real, límites flotantes nativos y cancelación BASE4 de20.000filas.
La suite de inventario/nativa existente conserva los demás fences. Los snapshots
incluyen todas las tablas; el setup completa el backfill normal antes de capturar.

La tolerancia20% autorizada aplica sólo al timing, nunca a cantidades o decisiones.
Requiere revisión/QA/SYNC/performance independientes sobre SHA congelado y el mismo
protocolo100×3 contra71e y937, sin alterar fixtures para ocultar costes. La rama530
y PR898 cerrado conservan experimentos y fallos anteriores; no se mezclan aquí.
No implica aprobación de performance, UI/dispositivo o release. No se ejecuta DDL
operativo, APK/install/ERP/remoteSQL/flags/readiness/activation/merge/deploy.
