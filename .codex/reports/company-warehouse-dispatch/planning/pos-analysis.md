# G0 — Integración POS y despacho separado por empresa

Evaluador: `/root/pos_dispatch_analysis` (integration), 2026-11-06. Solo lectura de fuentes; no código funcional, DB remota, APK o datos operativos modificados. Fetch readonly del POS realizado sin checkout/reset. La worktree POS original con conflictos permanece intacta.

## Revisiones y alcance

- ERP: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-ERP-company-dispatch`, base `68519916a1c8f2007c6146edc6a70b496efc3cff`, origin/clean-erp.
- POS oficial: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS`, fuente leída mediante `git show origin/develop:<path>`, SHA `1e3273e94309c2a4e50b19767cef981eaf51f5dd`. AGENTS y AGENT_RELEASE_PROTOCOL del POS definen develop como fuente oficial, no Polaris ni worktree firmada. Esta diferencia es específica de cada repositorio, no propone usar develop para ERP.
- Android en esa fuente: versionCode1629/versionName1.1.629. No se ha identificado ni certificado la versión del dispositivo operativo. El documento local RELEASE_SOURCE_OF_TRUTH menciona un APK antiguo781 y no es evidencia del runtime actual.
- Leídos: AGENTS/WORKFLOW/perfil integration, seis mapas ERP, CODEX_HANDOVER y setup-terminal-api; POS AGENTS, protocolo release y documento de fuente de verdad. Los mapas históricos no sustituyen estas revisiones.

El requisito nuevo del usuario incluye OFFLINE obligatorio con cupos preasignados a terminal. No es aceptable un MVP online-only ni tratar stock cacheado como autoridad para prometer mercancía.

## Hallazgos concretos y consumidores

1. POS `App.tsx:11662 handleTransactionComplete`: el camino legacy marca tracking como SOLD y crea inventoryLedger mediante processInventoryDeduction. En `11781` el commit durable incluye transactions/history/ledger/tracking y Outbox SALE_POSTED; si no hay durable outbox, guarda documentos secuencialmente. El V3 entra por `persistV3FinancialTransaction` antes de ese camino.
2. POS `services/sync/LargeMasterSyncV3FinancialCommit.ts:66 buildV3InventoryLedger` crea qtyOut para venta, qtyIn para devolución; respeta unidades BASE, recetas y variantes. `:211` prepara trackingCommits; `:231` libera compromisos de una reserva previa al facturar; `:245–271` materializa ledger y stockRequirements; `:319/:348` serializa SALE/NC; `:365` realiza commit nativo durable. Liberar la reserva al facturar es el comportamiento contrario al nuevo modo diferido; no debe reutilizarse sin snapshot de modalidad.
3. POS `services/db/adapters/CapacitorSQLiteAdapter.ts:569 commitFinancialTransaction` pone documentos, intents, Outbox, validación de stock, tracking y nacimiento fiscal bajo su write queue/transacción. `:627–640` exige trackingCommits consistentes y consume cuota; `:1340–1460` valida baseline/authority y disponible. Nuevo débito de cupo y obligación de despacho deben ocurrir dentro de esa misma transacción, no como save posterior.
4. POS `services/db/V3Base4Stock.ts` y V3Base6Stock calculan físico desde baseline + inventoryLedger, disponible restando reservas/compromisos del baseline. `LargeMasterSyncV3SqliteStore.ts:140–205` y OperationalSession proyectan deltas similares; el reconciled journal de articleFormats es otro camino. Añadir solo inventoryCommitments a documents no reduce por sí solo el disponible V3. Todos los lectores/precondiciones afectados deben conocer el nuevo compromiso local sin fingir una salida física.
5. POS `services/sync/DurableOutboxBatchSender.ts:205` distingue APPLIED/DUPLICATE (markAppliedErp) de RECEIVED/STAGED/PROCESSING (markSyncedMaster). Ni la mera recepción ni un ACK perdido autorizan liberar cupo. El estado APPLIED local tampoco prueba que un snapshot nuevo ya incluya el compromiso: necesita un identificador/watermark de absorción explícito y durable.
6. Config POS: types.ts:855 y :1310 inventoryScope no tiene modalidad de despacho; `utils/terminalConfigSnapshot.ts:2847/:3105` construye inventario y `utils/erpSyncLifecycle.ts:2253 buildCompatibleInventoryScope` devuelve explícitamente almacenes, por lo que un campo ERP nuevo no se usa automáticamente. `services/sync/OperationalTerminalConfig.ts` valida identidad y fuentes de inventario, no modalidad nueva. Setup, CONFIG_PUSH_V2 y refresco de catálogo deben transportar/validar policy revision y capability sin permitir override local.
7. ERP `terminalConfigSnapshot.js:2680 getResolvedTerminalConfig`, `:2770 buildBaseSnapshot`, `:2837 resolved.inventory` y `:3492` enriquecimiento de warehouses son superficies del contrato. Express setup.js y serverless api/sync/_lib.js consumen ese snapshot; setupV3LightBootstrap y manifest/caches deben cambiar de versión con la política efectiva.
8. ERP `posEventApplier.js:3730 applySalePostedBusiness` tiene camino nuevo y dos replays de documento previo que vuelven a aplicar inventario en :3787/:3920; el camino nuevo llama :4059 y contabiliza :4091. Cambiar solo el camino nuevo permitiría que un replay descontara una venta diferida. `applyPosSaleInventoryMovements:3279` genera VENTA y controla duplicados existentes. El claim de inbox :4940 evita dispatch concurrente normal, pero no convierte múltiples REST en una transacción. El snapshot de modalidad original debe sobrevivir retries/recovery y company config changes.
9. ERP `services/fiscal/posFiscalV3ApplicationPlan.js:64` congela inventario/totalCost/política contable sin dispatchMode. `posFiscalWorkflowV2Materialization.js:38–69` exige movimientos VENTA exactos y SALES_COGS por factura; luego valida captura/ACK fiscal. Saltar movimientos sin un contrato versionado de reserva rompería la materialización fiscal. Debe probar la obligación de despacho y ausencia de VENTA/COGS mientras pendiente; COGS se contabiliza al conduce sin repetir ingreso/impuestos/caja.
10. El POS actual tiene otros escritores de formatos (`services/articleFormats/posting.ts:214–248`, nativeV3Financial) con efectos físicos y conciliación propios. No se certifica que un guard en App cubra esos escritores. Todos deben optar explícitamente por el contrato nuevo o quedar fuera de activación hasta estar implementados, sin permitir evasión del parámetro de empresa.

## Reuso de cuotas existentes y límites

- ERP migración20261024175058: erp_item_tracking_units solo LOT/SERIAL; registro exige flags reales del producto. allocate_v1:136–152 bloquea unidad, deduplica request y suma cuotas no RETURNED. return_v1 exige barrera/proof RETURN_PENDING, no una expiración supuesta.
- Native `TrackingAuthority.ts` solo acepta LOT/SERIAL, escala1000000, identidad tenant/company/store/warehouse/terminal/device, revisiones y checksum. No usar un lote/serie ficticio para stock ordinario.
- `TrackingDeliveryWitness.ts` persiste testigo fuera de SQLite y reclama entrega one-shot; `TrackingAllocationStore.ts` conserva consumo monótono y reloj anclado al servidor, no reinstala propiedad perdida. Es un patrón reutilizable para la autoridad nueva.
- ERP bins migration:102–111 calcula retención offline como cuota tracking no consumida + movimientos PREPARED aún sin movimiento físico. Capturar tracking SALE PREPARED y añadir reserva comercial aparte duplicaría la retención si no existe handoff/funding comprobable dentro de una transacción.
- Si el nuevo escrow usa autoridades propias por producto/variante y referencia una trackingUnit real, debe impedir que allocate_tracking antiguo entregue simultáneamente la misma capacidad. El allocate antiguo suma solo sus propias filas. Requiere un lock/guard compartido entre ambos emisores o un handoff explícito; no dos pools independientes sobre el mismo físico.

## Contrato mínimo integral propuesto para ratificación

1. IMMEDIATE por defecto, WAREHOUSE_DISPATCH solo efectivo para una revisión de política emitida por servidor y consumidores compatibles. Política/source originales inmutables por operación; no reinterpretar ventas históricas al cambiar config.
2. Cupo central finito por tenant/company/warehouse/item/variant y dimensiones reales de tracking, ligado a terminal/device/generation y policy revision. Request estable, cantidades enteras en precisión BASE apropiada y hashes de autoridad; ni un boolean cliente ni una copia de stock son autoridad.
3. Emisión online inicial retiene capacidad central antes de entregar derechos offline. Entrega one-shot + testigo durable y ownership fencing. No hay promesa de vender sin cupo previamente recibido.
4. Venta offline: transacción SQLite única valida autoridad instalada, saldo de cupo, identidad y snapshot; consume cupo a obligación local pendiente, guarda venta/fiscal/pago/Outbox y reserva local; no salida física/COGS/tracking SOLD. Crash antes de commit no consume, crash después conserva mismo event/source e idempotencia.
5. Intake: una transacción SQL verificable cambia cupo emitido no materializado a reserva del documento por la misma cantidad, sin instante de liberación ni doble hold. Replay exacto devuelve mismo resultado; cambio de source/event/cupo falla. RECEIVED no equivale a materializado.
6. ACK/snapshot: obligación local sigue protegiendo disponible hasta prueba durable de que la reserva está incluida en la autoridad/snapshot central; absorber una sola vez mediante IDs/watermark. ACK perdido o snapshot viejo no libera capacidad ni duplica la resta.
7. Conduce: selección de ubicaciones/tramos y dimensiones, parcial <= pendiente; consume reserva y físico y registra COGS en la misma transacción, con idempotencia y linaje hacia venta/renglón/cupo original. Segundo conduce o replay no pueden exceder lo pendiente.
8. Cancelación/NC previa al despacho libera obligación una sola vez según prueba de origen; no devuelve cupo consumido local arbitrariamente. Después de despacho se requiere devolución física real hacia tramo/recepción, no incremento automático de stock por emitir NC.
9. Return de cupo no utilizado: prueba sellada de barrera local, pendientes e inflight conciliados; states inciertos/terminal reemplazada/reinstall no liberan propiedad por TTL. Consumo monótono y nuevas concesiones/compensaciones versionadas, sin decrementar historial a ciegas.
10. Activación de empresa: APKs viejos offline pueden seguir emitiendo movimientos inmediatos sin enterarse de config. Se requiere cutover con revisión/capability y drenaje/reconciliación de colas y autoridades previas; no cambiar semántica de esas ventas al recibirlas. Bloquear activación efectiva de consumidores incompatibles es distinto de ofrecer un modo online-only: después del cutover y asignación, el modo nuevo debe vender offline.

## Matriz G6 obligatoria

| Escenario | Invariante a probar con POS/SQLite y PostgreSQL reales |
|---|---|
| Dos terminales + ERP reservan último stock | Derechos globales disjuntos; nunca cuotas/reservas > físico disponible |
| Corte de red tras conceder/antes instalar | No segunda entrega ni recreación del mismo cupo |
| Dos checkouts concurrentes offline | Cupo local no negativo; venta+obligación+Outbox atómicos |
| Crash antes/después commit y reinicio proceso | Mismo source/event, cero duplicados de reserva, sin salida física |
| ACK perdido/duplicado/fuera de orden | Traspaso de hold central exacto; no phantom free ni double hold |
| Snapshot viejo/nuevo durante cola pendiente | Absorción solo con prueba; disponible correcto antes/después |
| Conduce parcial, retry y dos operadores | qtyDespachada <= reservada; inventario/COGS/reserva un único efecto |
| Cancel/NC antes y después despacho | Liberación o devolución según evidencia física, sin crédito doble |
| Lote/serie, unidades/variantes/recetas/formatos | Identidad y precisión BASE, cuotas disjuntas con tracking original |
| Cambio de empresa, dispositivo reemplazado, pérdida SQLite | Binding/generation/witness no recrean derechos viejos |
| Cambio de política con colas viejas | Original inmediato conserva su semántica; nuevo diferido no descuenta al replay |
| Config push perdido, polling/reconnect y bootstrap | Revisión recuperable/durable sin depender solo de Realtime |
| Modo IMMEDIATE y clientes anteriores | Bytes/efectos previos compatibles y sin nuevas restricciones inesperadas |

## Herramientas de ensayo existentes y estado

POS package no tiene npm test genérico; hay tsx --test por archivo y scripts específicos. Bases: tests/durableOutboxV2, durableOutboxBatchSender, tracking*, largeMasterSyncV3Inventory, articleFormatsNativeAtomicity/Inventory/ERPIntegration, configPushV2*. Deben añadirse escenarios del nuevo contrato, no renombrar esas pruebas como cobertura nueva.

Existe laboratorio Android separado `qa/fiscal-native`, paquete `com.clicpos.fiscalqa`, SQLite Capacitor real, DB sintética propia, sin INTERNET por defecto, y entrada online opt-in solo loopback. Puede ampliarse para escrow, reinicio de proceso y pérdida de ACK, previa revisión/autorización del laboratorio y selección explícita de emulador propio. No tocar com.clicpos.app, datos del POS operacional, worktree firmada o keystore. Sus puertos fiscal/config son sintéticos; no demuestra bootstrap/UI/APK de producto completos.

Estado: mapa G0 entregado para ratificación independiente, no autoaprobado. G6 de la implementación futura todavía BLOCKED hasta disponer de código congelado y evidencia real de consumidor/SQLite/ERP, incluyendo offline/reconnect. No ejecuté pruebas ni compilé APK en esta fase. Ninguna conclusión de instalación/despliegue se hereda de los archivos locales.

## Aclaraciones finales del coordinador y punto anterior al cobro

Root preparó el worktree POS aislado `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS-company-dispatch`, rama feature/inventory-company-dispatch desde origin/develop1e3273e9. El checkout original dirty no es base de implementación. Expediente leído: ERP `docs/development/tasks/company-warehouse-dispatch.md`, commit1d4432c5.

Criterios explícitos del coordinador: cupo agotado bloquea antes de cualquier cobro/autorización fiscal nueva, incluso si el artículo permite negativo en el modo inmediato. Servicios y no inventariables no exigen cupo. No crear backorders nuevos en modo diferido. No instalar APK release o tocar POS operacional para estos ensayos.

Punto exacto de integración anterior al pago: `POSInterface.tsx:7101 beforeV3PaymentEffects` se pasa a `PaymentModal.tsx:1128 beforePaymentEffects`; este hook corre antes de `authorizePendingGatewayPayments:1218` y `onConfirm:1233`. El nuevo prepare de cupo debe ejecutarse aquí antes de nueva autorización fiscal/pago, no únicamente en FinancialCommit cuando ya pudo cobrarse tarjeta. El hook devuelve `recordPaymentEffect` y callback de liberación: puede integrar fases PREPARED/EFFECT_POSSIBLE/CONSUMED de escrow. No liberar PREPARED después de resultado externo ambiguo; un recibo ya COMMITTED debe recuperarse primero y no requerir un nuevo cupo para reimprimir/rehidratar.

BASE4/BASE6 y tipos efectivos del ledger requieren conciliación antes de elegir escala de cupo: una cuota de seis decimales no puede autorizar una venta que después no pueda representar su conduce/comercial. No redondear silenciosamente ni esperar al despacho para descubrirlo.

La activación por empresa debe resolver terminales antiguas offline y autoridades previas: no se puede impedir por un flag de servidor que un APK viejo desconectado siga con su comportamiento inmediato. Es necesario handshake/capability/cutover de autoridad y drenaje probado antes de que WAREHOUSE_DISPATCH sea efectivo; después de esa asignación el POS actualizado debe seguir vendiendo offline con su cupo finito. No se propone deshabilitar offline en el modo solicitado.
