# Presentaciones comerciales en POS: implementación preparada, activación cerrada

Tarea `POS-2026-0001`. Base POS: `origin/main` (`d5c9180`). No se usa `develop` ni se importa código del ERP.

Referencia: [contrato ERP](https://github.com/fdiazinoa/CLIC-ERP/blob/feature/inventory-article-formats/docs/article-formats-pos-contract.md), [PR ERP 2247](https://github.com/fdiazinoa/CLIC-ERP/pull/2247). Consultado el 14 de octubre de 2026: el PR figura fusionado, pero eso **no demuestra despliegue**. Su serializer sigue sin productor de maestros y el ingreso legacy rechaza snapshots. Este cambio no los conecta ni cambia ese rechazo.

## Código entregado

- `services/articleFormats/contract.ts`: DTO exacto `schema_version/inventory_quantity_unit/item_id/formats`, snapshot camelCase, permisos/defaults snake_case y precios por `tariffId`. `ArticleFormatMasterPage` y `FormatLocalEvent` son puertos **locales propuestos**, no contratos de endpoints ERP existentes.
- `domain.ts`: decimal.js 10.6.0, precisión 40. Conversión comercial→base exactamente una vez; base hasta numeric(15,4), factores hasta cuatro decimales, rechazo de truncamiento/rango. Precio específico, incluido cero; fallback precio de tarifa base × factor. Costo por unidad base conserva hasta ocho decimales.
- `schema.ts`, `store.ts`: migración SQLite aditiva e idempotente. Maestros/revisiones, precios, recibos de páginas/ACK, Outbox, líneas originales, devoluciones y movimientos **en base**. No hay SKU ni balance por presentación. Identidad compuesta tenant/empresa/artículo/variante/formato/revisión.
- `sync.ts`, `master.ts`, `SyncManager.pullArticleFormats`: consumidor paginado mediante transporte inyectado, persistencia antes de ACK, replay, detección de contenido cambiado y revisiones fuera de orden. Consulta offline de maestro/barcode en SQLite. Hidrata una página acotada de productos para la vista, no initial-config; no cambia provisionamiento. El bootstrap legacy no registra este productor todavía.
- `ArticleFormatSelector`, carrito, variantes y barcode: formatos activos y `allow_sale`, contexto de variante por SKU estable, default primero, precio/equivalencia/disponibilidad derivada. Líneas distintas por presentación y contexto; el camino Unidad legacy no se mezcla con snapshots aunque comparta precio. Enter/scanner rechazan devolución rápida de formato y requieren el ticket original. Cantidad comercial sigue en `quantity`, precio comercial en `price`; snapshot en `articleFormat`, cantidad física en `baseQuantity`.
- `inventoryEngine`: el límite de inventario/reservas recibe `inventoryQuantity`; COGS conserva el costo base. Recetas siguen su motor actual después de convertir la cantidad de entrada. `conversionFactor` legacy conserva su significado y cantidades anteriores no se reinterpretan.
- Devoluciones locales preparadas: factor y precio de línea original, `.5 × 24 = 12`, límite acumulado protegido mediante trigger SQLite y transacción nativa. `RESTOCK` devuelve stock; `DAMAGED` y `NO_RETURN` tienen efecto físico neto cero. Es una política interna propuesta que el futuro adaptador ERP debe validar/mapping; no se deduce de un cliente no autenticado.
- Tickets HTML/ESC-POS muestran el snapshot histórico aunque cambien maestro/flag. HTML escapa el texto agregado. Promoción condicional elige `cartId` cuando existen formatos para no beneficiar dos presentaciones del mismo SKU.

`article_format_base_movements` es el diario preparado de movimientos para los eventos de formato, **no un saldo nuevo**. `commitLocalEvent` guarda evento, líneas, devolución y movimientos juntos usando `executeSet(..., true)` en SQLite nativo. Este diario todavía **no reemplaza ni integra atómicamente** las colecciones financieras, pagos, secuencias, reservas e inventoryLedger legacy. Por eso no puede usarse como checkout operativo ni afirmarse conciliación ERP completa.

## Activación y compatibilidad

`formatsEnabled` exige las dos condiciones ERP y todas las capacidades concretas:

1. `config.featureFlags.ARTICLE_FORMATS === true`.
2. `terminal.config.capabilities.article_formats === 1`.
3. Identidad/scope autenticados, productor paginado, eventos versionados de venta **y** devolución, posting local integral atómico y negociación efectiva.

`ARTICLE_FORMATS_READINESS` está congelado con todos los valores `false`, sin interruptor de ambiente ni setter de runtime. Marcar el flag o agregar datos a un producto no habilita ventas. El checkout, creación de transacciones, devolución y recepción/envío legacy rechazan líneas de formatos antes de efectos; no se envían al handler legacy. Artículos sin formatos continúan Unidad ×1 por su camino actual, sin snapshot nuevo.

La UI/precios/conversiones y los puertos preparados pueden ejercitarse con fixtures. La operación real permanece cerrada hasta implementar y validar las conexiones faltantes. No se anunció capability al ERP, no se cambió configuración remota y no se generó/instaló APK de formatos.

## Contrato POS→ERP pendiente

El ERP y su transporte deberán acordar **un nuevo evento versionado**; no se inventa aquí un endpoint, event_type ni autorización de despliegue. Requisitos de su handler antes de cualquier efecto:

- Obtener terminal, tenant, empresa, tienda, almacén, capacidades y tarifas autorizadas de la identidad autenticada. Validar scope y permisos de operación; no aceptar esos IDs como autoridad del payload.
- Validar `schemaVersion/id/variantId/name/abbreviation/factor/barcode`, SKU/contexto, revisión de maestro y snapshot autorizado al momento de venta, sin recalcular ventas históricas con un factor posterior.
- Validar precio/tarifa, descuentos/promociones, impuestos y redondeos ya aplicados; cantidad comercial, cantidad base y costo base coherentes. Rechazar precisión perdida o doble conversión.
- Congelar datos fiscales necesarios para reimpresión/devolución (incluidos impuestos/descuentos por línea). El `fiscalDocument` local conserva JSON del documento; falta un validador y esquema de red pactados, no se presenta como payload autorizado.
- Inbox durable con unicidad por identidad autenticada + evento y por línea; igual ID e igual contenido = replay sin efectos. Igual ID con otro contenido = conflicto. ACK solo después del commit durable; respuesta perdida permite retry sin otro movimiento.
- Devolución/anulación ligada a evento y línea de venta originales, precio/factor/costo históricos y límite acumulado protegido en PostgreSQL, incluyendo concurrencia. Negociar la política de retorno físico y permisos de merma/no retorno; el POS no decide el efecto ERP por sí solo.
- Conectar serializer al productor paginado y definir envelope de revisión/cursor/ACK. TariffIds deben venir de identidad autenticada; validar barcode también contra artículo/variantes y otros maestros activos. Los lectores locales rechazan ambigüedad.
- Integrar posting POS integral (documento/pagos/secuencias/inventario/reservas/Outbox) en una única frontera recuperable; mantener aislamiento tenant/empresa y no duplicar entre journal nuevo y ledger legacy.
- Mantener handler legacy protegido y negociar versiones mixtas. No emitir eventos de formato al fallback LAN/ERP legacy si no hay soporte completo.

## Recuperación

Las tablas existentes se conservan. Maestros se escriben atómicamente antes del ACK; ante error de ACK, el recibo sigue pendiente y se reintenta. Revisiones viejas se guardan pero no desplazan la más reciente. Outbox mantiene el JSON y el snapshot originales; el ACK cambia estado sin borrar el evento. Replay de venta/devolución no agrega movimientos. Exceso/conflicto aborta la transacción completa. Evento de devolución recibido antes de su venta se rechaza sin escritura parcial y puede reintentarse después.

No borrar tablas ni snapshots para hacer rollback. Si se retira la UI se conserva almacenamiento/historia y el bloqueo de transporte. Para activar después se necesita migración del journal preparado al posting integral validado; no copiar registros pendientes a la cola legacy.

## Pruebas y límites de evidencia

Las regresiones nativas compilan los métodos Java del parser instalado de @capacitor-community/sqlite con JDK 21 y ejecutan cada sentencia resultante sobre SQLite. El trigger de devoluciones usa un solo SELECT CASE compatible con ese parser; foreign_keys se habilita fuera de BEGIN. Se prueban recepciones legacy de lote completo/delta/historia antes de devolver documentos al consumidor.

Ejecutar `npm run test:article-formats`, `npx tsx --test tests/*.test.ts`, `npm run harness:test`, `npm run build` y `npm run lint`.

Los fixtures usan artículos, terminal y empresa sintéticos. Cubren cantidades/decimales/precios cero/tarifas, variantes/barcodes, snapshots, migración con venta pendiente, revisiones/duplicados/ACK, devoluciones parciales y acumuladas/concurrentes, fallo transaccional, reinicio SQLite offline, respuesta perdida/replay, aislamiento y rechazo legacy. Se reutilizan motor de inventario/COGS, promociones y cálculo fiscal/ticket ESC-POS reales.

El servidor de los escenarios de recuperación es un SQLite de prueba, **no PostgreSQL ni ERP desplegado**. La suite no acredita integración real, APK, impresión física, WebView, topología LAN ni rendimiento de dispositivos. `npm run lint` está bloqueado porque esta base carece de configuración ESLint 9; no se desactivan reglas para declarar PASS. QA/SYNC/OFFLINE/PERFORMANCE operativos requieren entornos y evidencia independientes. Mantener PR en borrador y feature cerrada cuando falten esos gates.
