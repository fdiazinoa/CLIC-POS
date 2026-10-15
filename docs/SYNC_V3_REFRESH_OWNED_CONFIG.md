# Lectura de identidad durante refresh V3

En prepare/activate/replay/unused-baseline, el store nativo ya posee la cola
compartida; algunos caminos también poseen BEGIN. El callback de identidad de
Session leía config mediante el puerto público, que se encolaba detrás de su propio
caller. El repro de SQLite real registra BEGIN y callback pendiente sin despachar
la consulta config. Esto prueba el defecto de fuente; no atribuye por sí solo cada
incidente observado ni convierte reinicios PostgreSQL en causa de ese ciclo local.

El callback admite un contexto opcional readonly con sólo readConfig. El adapter
inyecta su decoder, selección de documento current y compaction existentes usando
la conexión ya poseída. Fuera del callback se conserva db.get encolado. No existe
puerto SQL/write ni reentrancia general. El contexto se revoca al terminar el
callback, también en error; lecturas retenidas no pueden usarse después.

Se conservan las comparaciones de identidad, credencial/token, origen, empresa,
inventario, precio y fiscal, junto con owner, stock anchor, receipt, operational
window y fences de transacción. Los callbacks sin argumento siguen compatibles
en stores aislados; el adapter nativo siempre inyecta el lector de configuración.
No se altera UI, coordinator singleflight, timeout, readiness ni versión.

`tests/largeMasterSyncV3RefreshDeadlock.test.ts` usa adaptador y cola nativos reales
con SQLite host. Cubre prepare/activate/replay/unused, contexto revocado,
config concurrente, errores/rollback/restart y consumer de Session/coordinator.
El entorno de Session simula identidad/plataforma y el transporte de descarga,
pero usa el callback de producción y el store/decoder/transacciones reales.
No equivale a ERP HTTP real, render React, WebView o dispositivo.

La facturación sintética comprueba fuente de catálogo inmutable, pagos, secuencia,
stock e idempotencia Outbox; las cantidades siguen siendo exactas. La autorización
20% es sólo temporal. Revisión/QA/SYNC/performance independientes y prueba física
siguen separados; no hay generación/instalación APK ni permiso para ERP real.

La enmienda de factura mantiene la cobertura explícita normal. Sólo cuando falta
la celda permite un PRODUCT base actual con trackInventory y allowNegativeStock
canónicos estrictamente true, mismo ID en el catálogo del inventory anchor,
semántica física compatible y warehouse permitido en ambas fuentes. No eleva
un source histórico, artículo nuevo ni flags del carrito. Variantes, lotes, serial
y peso sin celda permanecen fuera de esta excepción conservadora. Todos los
stamps/receipts/binding/version/cursor y guard de reconciliación siguen vigentes.
No crea balances ni cambia la deducción; una unidad lleva0→−1 o−1→−2 una vez.
Los tests cubren además el builder financiero productivo con Session real y
commit nativo, sale/payment Outbox, replay e historial; los puertos de identidad,
transporte y autoridad fiscal del entorno host son sintéticos. Eso no acredita
la configuración actual del ERP ni la facturación observada en el dispositivo.
