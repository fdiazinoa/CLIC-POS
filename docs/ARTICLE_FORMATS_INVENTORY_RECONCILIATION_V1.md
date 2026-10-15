# Conciliación física de formatos v1 — soporte cerrado

Autoridad ERP: `e46a1a83e5f8bc34d7d42fd1c58fcb288c2aff53`, contrato
`docs/ARTICLE_FORMATS_POS_NETWORK_V1.md`, SHA256
`5ce0c723fe053b00aaef75a63a36d2c7799cdfedff3a9de508d98ab0592310e8`.

El módulo existente `services/articleFormats` conserva los envelopes y el conflicto
`POS_FORMAT_RETURN_CONTEXT_CONFLICT`. El ACK financiero sigue afectando solamente
Outbox/metadata financiera. El journal físico conserva originales completos,
contextos y efectos históricos en tablas independientes, sin FK al Outbox.
Originales, efectos, vínculo de scope, absorciones e historial son inmutables.
El posting escribe journal, stock y Outbox dentro de su transacción nativa existente.
Los antiguos eventos ACKED y PENDING requieren bootstrap completo o bloqueo explícito;
no se reconstruyen con maestros actuales ni se purgan para superar límites.

`ArticleFormatInventoryJournal.reconcileFixture` captura todos los originales no
absorbidos y la generación persistida. Verifica negociación, scope de siete campos,
ordinal decimal exacto, páginas completas/bytes UTF8/checksums, originales y efectos,
y el manifest inmutable devuelto por `/complete`. Las páginas sólo son staging.
`commitFixture` vuelve a verificar la prueba y relee binding/autorización, contexto
local estable y generación dentro de `runFinancial` antes de reemplazar el pool
agregado, absorber las pruebas exactas y conservar historial/watermark en un único
commit SQLite. `captureFixture` y `commitFixture` permiten probar restart/replay y
fallos en cada escritura/COMMIT. Staging no es autoridad ni se activa al reiniciar.
Los errores ambiguos de COMMIT se resuelven leyendo el estado durable; el mismo
manifest/baseline ya persistido sólo admite replay exacto sin repetir absorción.

No hay un baseline por variante. Las celdas son artículo/warehouse/local y los
efectos conservan ERP_ID de variante. La autoridad física seleccionada es baseline
más journal no absorbido. El ledger histórico sigue disponible para auditoría y
no se suma de nuevo. Native preconditions, lectura financiera y consulta operacional
single/batch usan la misma selección. La proyección de sesión recibe disponibilidad
absoluta seleccionada, sin cancelar cantidades binarias ni restar reservas V3
antiguas. Los sellos V3 comerciales históricos permanecen
separados. Sin baseline seleccionado el camino V3/legacy conserva su aritmética
anterior (incluida precisión seis decimales); el selector añade una consulta acotada
a scopes activos, con índice parcial, sin parsear originales ni recorrer catálogo.

## Límites de activación y reservas

Las seis propiedades de `ARTICLE_FORMATS_READINESS` siguen en false. El descriptor
`FORMAT_INVENTORY_READINESS_V1` y el nombre de capability están preparados, pero
ninguna ruta normal los anuncia ni escribe configuración/grants. La opción de
transporte `fixtureInventoryReconciliationV1` está apagada por defecto y añade la
cabecera únicamente a negociación y las nuevas rutas de inventario, nunca al replay
financiero o a los masters V3.

No existe mapping confiable `local_id` en el binding operativo actual. Por tanto
no se conecta este canal al runtime real. `installInventoryFixtureBinding` recibe
un scope completo explícito y un identificador de autorización **sintéticos**, sólo
para fixtures aisladas. `bootstrapFixture` además exige atestación histórica explícita
por cada event_id, incluso ACKED. El binding actual no prueba el dispositivo/local
de un evento antiguo. Faltantes o ledger interno/legacy bloquean el bootstrap entero.

ERP v1 suministra `qty_physical` y `qty_committed`, pero no `qty_reserved`.
`readReconciledPhysicalInventory` permite comprobar la dimensión física por separado.
La disponibilidad comercial/native/UI requiere una autoridad de reservas independiente
vinculada al mismo baseline; `reservationAuthority` es un descriptor interno de
fixture, **no** un campo ERP, permiso o nuevo contrato de red. Su ausencia bloquea
explícitamente `POS_FORMAT_INVENTORY_RESERVATIONS_UNPROVEN`: nunca se inventa cero ni
se mezclan reservas V3 antiguas. Movimientos locales no-format sin prueba de inclusión
bloquean reemplazo/lectura del pool afectado; un ACK legacy no los reconcilia.

El request completo, incluyendo schema/generation, tiene límite200 eventos/8MiB
UTF8. El servidor tiene límites independientes de50000 celdas/10000 eventos
históricos/64MiB del corte. El cliente valida50000 celdas y hasta502 páginas de100
filas (balances+eventos); aplica un techo de128MiB al texto de páginas recibido
para acotar recursos de la representación duplicada. Un exceso, fuente incompleta,
page/hash/count faltante o cambio de contexto no permite reemplazo parcial.
No hay purga de historial ni modificación de límites ERP.

Cada selección persiste contexto nativo estable y autorización explícita en
`article_format_inventory_authorities`, inmutable por receipt. Los lectores y el
replay comparan esa identidad con la actual; cambios de grant/fingerprint/binding
invalidan la selección hasta un nuevo recibo completo con ordinal superior.
Actualizar únicamente reservas independientes para el mismo baseline no cambia
esa identidad; heartbeat/lastSeen se excluyen expresamente. La nueva tabla es una
migración aditiva: un baseline de la primera versión sin evidencia de autorización
permanece guardado, pero su lectura/replay se bloquea hasta conciliación nueva;
no se reconstruye la autorización histórica a partir del contexto actual.

El escritor nativo ordinario no tiene prueba de inclusión en el canal sólo-formatos.
Una demanda o movimiento físico no-format que solape un warehouse seleccionado se
rechaza antes del commit (`POS_FORMAT_INVENTORY_UNSUPPORTED_WRITER`), incluso cuando
su política de artículo no exige cantidad. El camino legacy de seis decimales queda
disponible únicamente sin solapamiento con autoridad seleccionada.

Las funciones raw de lectura multi-query requieren que el caller conserve propiedad
de toda la lectura bajo la cola nativa compartida o `runFinancial`. Los métodos
públicos del store, incluida `getOperationalStockProjection`, están clasificados
`read` en el proxy nativo y protegen la operación completa. Una secuencia de queries
bloqueadas de forma independiente no cumple ese contrato de propiedad.

## Pruebas y evidencia separada

Con Node22 y dependencias del lockfile instaladas:

```sh
./node_modules/.bin/tsx --test tests/articleFormatsInventory.test.ts
./node_modules/.bin/tsx --test tests/productStockPolicy.test.ts tests/largeMasterSyncV3RefundAuthority.test.ts tests/largeMasterSyncV3OperationalCatalog.test.ts tests/largeMasterSyncV3CheckoutAuthority.test.ts tests/largeMasterSyncV3FinancialAtomic.test.ts
```

La primera suite usa SQLite real (`better-sqlite3`), archivos durables/reopen y el
adaptador nativo real sobre un puente host controlado; HTTP es un mock explícito.
Cubre los dos órdenes ACK/inclusión, varias generaciones/cortes, rollback de cada
escritura, BEGIN/COMMIT ambiguo, retorno/políticas/VOID, variantes/pool compartido,
validación completa multipágina y corrupciones, drift, bootstrap y límites.
No prueba Android/plugin/WebView/dispositivo ni integración offline física.

La suite opt-in separada exige un runner original ERP2252 **nuevo y desechable**:

```sh
bash /tmp/clic-erp-inventory-reconciliation-v1/run-local.sh
# En otra terminal, después de LOCAL_ERP_READY:
CLIC_FORMATS_INVENTORY_LOCAL_FIXTURE=/tmp/clic-erp-inventory-reconciliation-v1/local-fixture.json ./node_modules/.bin/tsx --test tests/articleFormatsInventoryERPIntegration.test.ts
```

El runner y su preparación/provenance pertenecen al expediente externo de SYNC,
no al repositorio. `LOCAL_RUNNER.md` en ese directorio explica creación y destrucción
por Ctrl-C/SIGTERM, PostgreSQL17 por Unix socket y HTTP127.0.0.1. La suite comprueba
los bytes del contrato ERP fijado, stock137 y cero eventos previos; usa HTTP real,
PostgreSQL local sintético y SQLite durable con adaptador/puente host. Sólo hace
SELECT SQL local para verificar aislamiento y obtener mapping confiable de fixture;
no SQL remoto ni mutación ERP. Sin variable la suite se omite y ello **no** acredita
integración real. No registrar credenciales del JSON privado en logs/repositorio.
La ejecución independiente y su SHA exacto deben constar en el expediente SYNC.

## Política ordinaria de venta por artículo

La ampliación aprobada usa `requiresProductStockAvailability`: sólo exige cantidad
si `trackInventory===true && allowNegativeStock!==true`. Global/terminal no sustituyen
los checks del artículo. Los componentes de kit conservan su propia política y un
componente ausente sigue siendo error estructural. V3 valida política del maestro
autoritativo en checkout/demanda nativa, no flags de la línea enviada. Lecturas de
cantidad no pueden imponer bloqueo oculto a artículos exentos; binding, warehouse,
catálogo, tarifas, fiscalidad y autorización siguen siendo obligatorios. El perfil
ERP de formatos continúa rechazando artículos no inventariables/sin control de stock;
no se amplía el contrato ni se reescribe el ledger contable.

Revisión, QA, SYNC, performance y dispositivo son gates independientes. Este código
no autoriza activar formatos, generar/instalar APK, fusionar ni desplegar.
