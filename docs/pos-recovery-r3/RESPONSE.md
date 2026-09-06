# Respuesta POS a ERP R3 — 6b05ff8d / PR 2001

Fecha 2026-09-06. **Solo evidencia, perfiles y decisiones propuestas. No implementación ni corrección de cálculo. Legacy continúa UNKNOWN; cierre exacto NOT_GRANTED.**

## Validación y alcance

- ZIP `pos-recovery-contract-6b05ff8d.zip`: todos los archivos de SHA256SUMS coinciden. PR ERP #2001 consultada: head `6b05ff8d7274d89bc0fc863c0a23bd9ac65a22a5`, base clean-erp, estado MERGED. Integrar documentos no significa implementar sus APIs.
- Verificador R3 de fixtures: PASS (4 paquetes de descarga + 1 candidato separado, 3 vectores, 5 negativos).
- Verificador R3 de schema: PASS (42 envelopes, 10 negativos, 15 evaluaciones de originales, ninguna certificada).
- POS auditado aquí: `2e200a2ff7854cbb08fa8218cffb09dbdb7bdf57`, origin/develop, que incluye PR #555. Sin cambios de App/types/sourceIdentity/erpOutboundPayloads/localRefundPersistence frente a `5993b1f` en los archivos comparados.
- Exportación local: 20 definiciones textuales de types.ts, 14 casos de serialización/evidencia, seis casos timestamp; se ejecutaron serializadores puros y el método real de construir body con contexto ficticio. Se sustituyó únicamente diagnóstico por no-op y se proporcionó contexto sintético de credenciales. No se cargó el adaptador de red, DB, proveedor fiscal ni persistencia de devoluciones.
- Se repitieron las 8 comparaciones de cálculo y 21 proyecciones del paquete POS anterior: PASS. No son pruebas de restauración, impresión, frontend completo, aislamiento ni transacciones distribuidas.

Archivos entregados:

- `native-definitions.ts.txt`: definiciones textuales (obligatorios, opcionales, uniones y herencia). Es evidencia, no unidad de compilación; algunos nombres auxiliares referenciados conservan su nombre nativo.
- `native-fields.json`: índice de campos/tipos/optional y herencia para comparación automática.
- `serialization-pairs.json`: objeto local JSON, tipos Date originales anotados, item serializado, body HTTP directo bajo contexto ficticio, diferencias por JSON path, payloads batch, antes/después fiscal/devolución, casos sin emisor identificado.
- `export-evidence.cjs`: reproduce las exportaciones sin red/DB, mediante TypeScript instalado en el repo. Para ejecutar: `node docs/pos-recovery-r3/export-evidence.cjs`. En esta revisión se usó NODE_PATH apuntando al node_modules del checkout principal. El archivo fuente se lee desde este checkout, no desde dependencias compartidas.
- `../pos-recovery-native/`: esquemas mínimos propuestos, fixtures y resultados monetarios ya enviados. Son complementarios a R3, no un acuerdo de recuperabilidad.

**Los ejemplos son sintéticos y sin datos personales**, construidos con formas reales y pasados por serializadores reales. No se dispone de autorización específica ni copia del dispositivo afectado para exportar devoluciones reales. No presentamos estos objetos como operaciones reales anonimizadas ni el body sintético como captura de tráfico desplegado. La validación de una muestra real de cada canal sigue pendiente.

## 1. Diferencias por campo respecto a los perfiles candidatos

| Campo R3 | Definición y uso POS | Resolución propuesta |
|---|---|---|
| Transaction.terminalId requerido | `types.ts:1789` opcional; fuente canónica proviene de configuración/credencial. Adapter :2445 remapea terminalId/source_terminal_id a UUID ERP | Requerir ámbito verificado en envelope de recuperación, no fabricar original. Conservar local_terminal_id/localTerminalId como procedencia. Un alias no autoriza ámbito. |
| Transaction.documentType/status | documentType opcional union DocumentType; status requerido PENDING/COMPLETED/REFUNDED/PARTIAL_REFUND | Perfil de cálculo debe comprobar clasificación, no solo forma de items/payments. Falta de tipo en legacy es limitación, no SALE por defecto. `VOID` NO es valor de Transaction.status. |
| Transaction.userName | Requerido, impreso/utilizado para atribución; se conserva por spread | Mantener cuando llegó; carencia afecta fidelidad nativa/impresión, no necesariamente suma de efectivo. Nunca consultar nombre vigente para reemplazar original. |
| CartItem.id / cartId / productId | id heredado de Product es producto; cartId identifica renglón. `productId` no sustituye id/cartId en este tipo | Cambiar ejemplos futuros para preservar ambos IDs. No inventar cartId por ordinal. Líneas repetidas del mismo producto requieren distintos cartId. |
| CartItem.name | Requerido por Product, no required en perfil R3 | Añadir para perfil de impresión. Su ausencia no impide toda suma, pero impide afirmar etiqueta/topProduct fiel. |
| Product.category/images/attributes/variants/tariffs/appliedTaxIds | Son requeridos por Product; CartItem hereda todos. Directo elimina images/attributes/variants/tariffs y varias definiciones; mantiene category/appliedTaxIds si existían | No exigir todos los maestros para copia o efectivo. Separar DTO operacional de Product completo. appliedTaxIds no reemplaza importes/tasas históricos ni autoriza recalcular con catálogo actual. |
| PaymentEntry.timestamp | Date nativo, pero objetos rehidratados pueden contener string; normalizador directo acepta ambos y valores legacy numéricos de facto | Wire ISO con zona para perfil nuevo, como se detalla abajo. Normalización no debe crear fecha de recuperación. |
| PaymentEntry.method | Unión PaymentMethod en definiciones, R3 solo string | Preservar método original, etiquetas e ID; distinguir CASH/CARD/CREDIT/STORE_CREDIT/WALLET. Método desconocido debe producir clasificación UNKNOWN, no CASH. |
| PaymentEntry moneda/aplicado/cambio | Opcionales nativos; alias snake_case/camelCase y amountApplied | Preservar ausente vs cero. El emisor prioriza varios aliases snake_case. No afirmar cálculo exacto con tasa/moneda/dirección desconocidas aunque schema permita ausencia. |
| Collection.seriesId/seriesNumber | **Opcionales**, no necesarios para todo Collection emitido. Anticipo agenda usa displayId ANT-* sin esos campos | Retirar required incondicional R3; exigirlos solo si existen/procedencia de serie lo demuestra. No inventar una serie para anticipo legacy. |
| Collection FX/recibido/aplicado/no aplicado | Opcionales nativos, pero abono actual los guarda | Aceptable exigirlos para perfil nuevo de exactitud, declarando que es más estricto que legacy. No convertir todo Collection viejo en válido con totalAmount copiado a cada campo. |
| Allocation.timestamp | string; collectionId y transactionId son IDs POS, no factura ERP | Conservación literal y validación de zona si perfil nuevo; no sustituir IDs por factura/asiento ERP. Requiere dependencias de documentos cerrados fuera del conjunto. |
| CashMovement.currencyCode/terminalId | Opcionales nativos; perfil R3 los exige | Igual criterio: scope/moneda comprobables requeridos para calcular, pero no rellenar el original. reason/timestamp son fuentes; concept/createdAt no siempre equivalentes. |
| ZReport.baseCurrency/transactionCount | **Requeridos nativos y ausentes del perfil R3** | Añadirlos. cashCounted/cashDiscrepancy son mapas por moneda, no totales convertidos. notes es requerido pero puede ser string vacío. |
| ZReport.stats/denominationBreakdown/closeTaxSummary/paymentMethodSummary/reportDetails | Opcionales, usados por presentación/reimpresión según configuración (ZReportReceipt y sus helpers) | Preservarlos todos si llegaron; validar capacidad de reimpresión por secciones, versión y configuración. No regenerar un Z histórico con tarifas actuales. |
| ADVANCE.appointmentId | No es el original de AgendaService | Usar original Collection + bookingActivityId; kind ADVANCE puede ser metadato de envelope acordado, no otro recibo. |
| WALLET.direction/currency/customerId | Fila actual WalletTransaction tiene walletId,type,**amount firmado**,referenceId,timestamp; emisor puede no llevar moneda ni customerId | No inventar esas propiedades. Wallet maestro contiene currency/customerId; sin snapshot histórico coherente, esas capacidades siguen UNKNOWN. |
| originalRevision/version | No existe protocolo durable común para esos originales hoy | Los `schemaVersion:1` del outbox y default aggregateVersion=1 no prueban revisión operacional. Legacy sigue UNKNOWN. |

`tsconfig.json` no activa strictNullChecks ni exactOptionalPropertyTypes. Los tipos no son validadores runtime: no inferir rechazo de null desde TypeScript. JSON.stringify omite undefined en objetos, conserva null y convierte Date inválida a null. El contrato nuevo puede ser más estricto, pero debe devolver incidencias para legado y jamás normalizar silenciosamente ausencia como cero.

## 2. Objeto local → payload por canal

En `serialization-pairs.json`, SALE_DIRECT, REFUND_*, CARD_VOID, CASH_MOVEMENT, Z_REPORT y WALLET_PAYMENT contienen el body completo construido por `buildOperationalPostBody` bajo contexto ficticio. Incluyen nombres ficticios userName/customerName, customerSnapshot y campos nativos Z. Un objeto omitido sigue omitido; no se añadieron propiedades al emisor del producto.

### Directo: blocklist y cambios

`erpOutboundPayloads.ts:124–162` quita de items: attributes, variants, tariffs, images, stockBalances, warehouseSettings, activeInWarehouses, availableModifiers, modifier_groups/modifierGroups, fraction_rule/fractionRule, combo_groups/comboGroups, note_presets/notePresets y operationalFlags. Se conservan por spread cartId, id, name, userName del documento, customerSnapshot, impuestos/descuentos y selecciones de restaurante cuando existen. sanitizeTariffRefs elimina IDs de tarifas no UUID y filtra sus listas, tanto en item como en raíz/metadata. normalizeTransactionItems también normaliza descuentos/promociones; no es copia byte a byte.

`sourceIdentity.ts:142–201` usa allowlist de pagos: id,method,methodId/Label/Icon,creditOverrideApproved,amount,timestamp,currencyCode,amountOriginal,exchangeRate,appliedAmount,changeAmount,changeCurrencyCode,amountApplied y campos seleccionados gateway (provider/integration/type/status/responseCode/Message/authorization/reference/sequence/invoice/batch/merchant/terminal/order/processedAmount/Tax/maskedPan/brand/entryMode), más aliases source_* y monetarios. **No viajan por esa proyección gatewayRawResponse, gatewayReceiptClient/Merchant, firma ni campos desconocidos del pago**. La existencia local no demuestra copia remota.

`buildErpSalePayload` añade transaction_date, currency_code, exchange_rate, customer_ref y código de cliente; en fiscalMode NONE elimina ncf/ncfType/legacyNcf/electronicNcf y fuerza proveedor NONE. currency_code de raíz puede ser la moneda de liquidación extranjera, **no necesariamente moneda base**.

`ApiSyncAdapter.buildOperationalPostBody:2445` añade ámbito del request desde credenciales. En items y pagos sustituye terminalId/terminal_id/erp_terminal_id/source_terminal_id por UUID ERP; preserva alias local cuando difiere. Cambia device_id al actual. Para target local (`useLocalTarget=true`) no aplica ese remapeo. El alias guardado solo ayuda a correlación, no prueba empresa histórica.

### Batch: no suponer la misma blocklist

`App.tsx:9395` crea SALE_POSTED/PAYMENT_POSTED con UUID eventId persistido, aggregateId=txn.id y schemaVersion=1. `SalePostedContract.buildSalePostedPayload:366` usa directamente `transaction` y summary; **no llama al saneador de envío directo**. El ejemplo BATCH_PAYLOADS confirma que images/gatewayRawResponse siguen en ese payload mientras el directo los elimina. PAYMENT_POSTED clona pagos de liquidación; es representación adicional, no ingreso adicional.

Se entregan payloads reales de esos constructores, no un HTTP batch ejecutado. `DurableOutboxBatchSender.toDurableWireEvent:54` los envuelve con eventId/localSequence/aggregateType/aggregateId/aggregateVersion/schemaVersion/createdAt; postOperationalPostBody agrega contexto raíz, pero solo remapea items, no transaction anidada en events. Confirmar en ERP el alcance histórico de cada canal; la forma directa no se puede extrapolar al batch.

### Colecciones, anticipo y wallet

Collection/BookingAdvance se entregan con `httpBody:null` y `NO_VERIFIED_OPERATIONAL_ERP_SERIALIZER`. No hay payload exacto enviado que podamos demostrar para esos tipos. El ejemplo abono contiene dos allocations (30+50), recibido100/aplicado80/no aplicado20; los documentos target se requieren read-only, preservando sus IDs/estado histórico y fuera de sumas del cierre. No reaplicar allocations ni recalcular deuda al importar.

Wallet sí tiene normalizador y ruta operacional: `transactionService.ts:844` agrega createdAt,terminalId,operationalChannel y syncStatus al tipo base. PAYMENT usa amount negativo (`:773`), DEPOSIT/refund depósito positivo. `referenceId` puede recibir displayId desde llamadas `:769–790`: **no asumir UUID de transacción** aunque el normalizador lo copie a source_transaction_id. Debe resolverse identidad con evidencia o marcar relación UNKNOWN. La fila actual no contiene necesariamente moneda/cliente; no deducirlos del wallet actual sin snapshot histórico. No sumar STORE_CREDIT y evento wallet como dos cobros.

## 3. Timestamps: acuerdo POS propuesto y comportamiento actual

Se acepta ISO-8601 con zona y precisión hasta milisegundo **como contrato futuro**. Preservar los bytes JSON del original para hashes; un Date de vista no reemplaza el original. Fechas de operación y recepción deben estar separadas.

| Entrada local al normalizador PaymentEntry | Wire observado |
|---|---|
| Date / string `2026-09-05T23:59:00.123-04:00` | `2026-09-06T03:59:00.123Z` |
| string `2026-09-06T00:01:00.000-04:00` | `2026-09-06T04:01:00.000Z` |
| epoch **milisegundos** 1788666600000 (reloj atrasado) | `2026-09-06T03:50:00.000Z`; no corrige el reloj |
| null / ausente | hora actual del emisor, fijada en prueba a `2026-09-06T16:00:00.000Z` |
| string inválida | null al serializar Date inválida |

Las dos últimas filas son pérdida/fabricación histórica del emisor existente, **no adaptación aceptada para recuperación**. Timestamp válido no demuestra que no fuera generado previamente. No admitir epoch ambiguo segundos/milisegundos ni timestamp sin zona en un perfil nuevo. Allocation.timestamp/date de Collection y CashMovement.timestamp son string; la persistencia JSON conserva su zona/texto. No hay conversión de Allocation por un emisor ERP demostrado. El normalizador de movimiento añade created_at desde timestamp pero no garantiza createdAt camelCase; summary ERP debe leer el original.

openedAt de solo abonos: no hay instante de apertura independiente persistido. Si Z existe, usar su openedAt original aunque sea fallback de hora de cierre; si se perdió antes de persistir/enviar, ese instante **no es recuperable exactamente**. Un cierre futuro tendrá otra hora. No usar date del abono como sustitución histórica. Lo mismo aplica a la declaración física perdida: no puede derivarse de ventas.

## 4. Devolución, VOID y mutación fiscal

**Representación aceptable del flujo observado:** Transaction nueva `documentType=REFUND,status=REFUNDED`, total/quantity positivos, ID propio NC, originalTransactionId y affectedInvoiceNumber/NCF, pagos reales del método. En el flujo normal `App.tsx:10650`, pago positivo STORE_CREDIT; CARD_REFUND/CARD_VOID entregan pago CARD con gatewayTransactionType REFUND/VOID y referencias proveedor (TicketHistory :2225/:2352). No reutilizar eventId de venta como nota.

Conjunto para comparar: solo NC en transactions + fondo1000 en cashMovements; venta original cerrada es dependencia fuera del conjunto. STORE_CREDIT/CARD → cashExpected DOP1000; returnsTotal50. Si la original también pertenecía legítimamente al conjunto, se conserva su venta y la NC separada; el estado REFUNDED del original no resta dos veces (analytics cuenta venta original y resta nota).

`ORIGINAL_SALE_REFUND_MUTATION` muestra before/after sintéticos: una de once unidades a50 devuelta; venta total550 intacta, status PARTIAL_REFUND, relatedTransactions con NC, updatedAt y syncStatus PENDING. `localRefundPersistence.ts:42–115` normaliza quantities/total positivos, guarda nota e historial, ajusta inventario y original, dispara worker. **No se ejecutó ese helper**, pues no es restauración segura. No hay revisión append-only común demostrada: PENDING de la original no garantiza que mismo eventId remoto conserve la mutación.

**F04 CASH positivo:** mantener 1050 como resultado diagnóstico del código. No cambiar signo, no excluir selectivamente la NC para forzar950, no asignar otro método al importar. La decisión POS es **no validar ese fixture como flujo de reembolso CASH** hasta tener un caso de emisor/pasarela autorizado y probado. Reembolso cash, cambio multimoneda de devolución, STORE_CREDIT contra deuda pendiente y mutación VOID comercial independiente requieren evidencia adicional; no se inventan aquí. El ejemplo multimoneda de venta no prueba devolución multimoneda.

VOID comercial no tiene objeto/revisión/tombstone universal acordado. CARD_VOID observado termina en **NC REFUND**; no implica que todas las anulaciones deban convertirse a NC. El objeto ERP `{status:VOID,transactionId,...}` continúa candidato y no puede hidratarse como Transaction.

Fiscal: `pollFiscalDocumentStatus` App :9131 agrega fiscalSyncStatus,fiscalReferenceId,fiscalResponseMessage,fiscalSyncedAt; `upsertFiscalTransaction:8979` guarda transactions e historial. Se entregan before/after y su serialización potencial al mismo ID. **No es canal FiscalUpdate probado** ni historial de revisiones remotas: la copia inicial del outbox puede seguir antigua. No reenviar SALE para actualizar fiscal al recuperar; un canal técnico de revisiones deberá preservar referencia/número sin emisión nueva.

## 5. Decisión POS sobre manifiesto (propuesta para ratificación ERP)

Adoptar versión nueva `pos.close-manifest.v1`, separada de Z legacy. Propuesta de campos:

```json
{
  "schemaVersion": "pos.close-manifest.v1",
  "closeId": "UUID-PERSISTIDO",
  "closeEventId": "UUID-PERSISTIDO-DISTINTO",
  "terminalId": "UUID-ERP",
  "storageEpoch": "UUID-EPOCA",
  "openSetId": "UUID-CONJUNTO",
  "previousCloseId": null,
  "revision": "1",
  "members": [{"kind":"TRANSACTION","originalId":"ID-POS","revision":"1","hash":"SHA256"}],
  "dependencies": [{"kind":"TRANSACTION","originalId":"FACTURA-CERRADA","revision":"1","role":"READ_ONLY"}],
  "sealedThrough": "123",
  "calculationVersion": "VERSION-A-ACORDAR",
  "configurationHash": "SHA256",
  "declarationHash": "SHA256",
  "reportHash": "SHA256"
}
```

Estos son marcadores, no IDs válidos ni esquema final aprobado. Precisar mapping de kind ERP SALE/NC a TRANSACTION y separarlo del tipo comercial interno. Miembros una sola vez por kind/ID/revisión; pagos embebidos son hijos, no segundo miembro que duplique efectivo. hash cubre original operacional/identidad/corte definidos, no estado remoto mutable. Dependencias no aportan ingresos; lista y orden canónicos según JCS acordado por ERP. previousCloseId null solo cuando se demuestre primer conjunto; desconocido se representa explícitamente como UNKNOWN en una envoltura legacy distinta, no null ambiguo.

POS deberá persistir en **una transacción local**: Z, manifiesto, membresías, avance documental reservado y evento técnico/outbox; archivo o marcas de cerrados sobre el conjunto exacto, sin perder la última copia. Crash antes = nada aceptado; después = mismo closeId/eventId/hash en reintento. El patrón de commit SQLite existe para ventas, **no para cierre completo**. IndexedDB/LAN requerirán garantía equivalente o capability=false; no prometer atomicidad multiplataforma por el esquema.

ACK perdido: buscar closeId/eventId originales. Si ya está recibido/aplicado/fallido, restaurar su referencia/estado, no crear otro. Mismo closeId/hash es repetición; distinto hash es conflicto, sin reemplazo silencioso incluso cuando el UI actual permita repetir Z. Las correcciones deben ser una operación explícita versionada aparte, fuera de recuperación.

## 6. Decisión POS sobre conjunto, época y sello (propuesta)

- Crear storageEpoch UUID con la base local nueva; guardar antes de operar. Crear openSetId UUID persistido antes de la primera operación del conjunto. Revincular sin perder base no cambia sus IDs; pérdida de base crea época nueva y referencia explícita a la anterior recuperada, nunca recicla su contador.
- Cada alta/mutación de venta, abono, movimiento, fiscal o cierre ocupa una secuencia operacional monotónica **en el mismo commit local** que documento+revisión+outbox técnico. Enteros decimales exactos en wire; operación puede generar varios eventos financieros, pero solo una posición de operación/revisión.
- Checkpoint propone `{epoch,highestCommitted,contiguousReceived,highestReceived,gaps,chainHash,finalSeal}`. ACK contiguo cuenta IDs/revisiones/hashes, no cantidad de filas. Un hueco puede detectarse, cola que jamás salió no.
- Sello final requiere transacción que graba finalSequence+hash y marca la época/conjunto cerrado a nuevas escrituras; todos los productores deben rechazar escritura posterior en ese conjunto. Nuevas ventas van a conjunto nuevo, sin modificar sellado. “Checkpoint enviado” de un prefijo abierto NO es sello final.
- Si la tablet se perdió antes de comunicar ese sello, **no existe prueba de cola final vacía**. No crear sello desde la tablet sustituta que certifique retroactivamente a la anterior. unknownTailPossible=true y exactZEligible=false incluso con prefix ACK completo. Esta limitación es inherente al respaldo asíncrono, no se resuelve con pairing.

Pendiente de acuerdo: almacenar/controlar cadena y secuencia por backend local; cuáles mutaciones crean revisión; protocolo de reanudación entre épocas y operación nueva; aceptación del sello por ERP. No hay cambios implementados.

## 7. Decisión POS sobre aceptación concurrente (propuesta)

Aceptar la separación download/receipt/status versus cierre. Importar permite copia/staging, no activa un Z exacto. Aceptación final requiere conexión o queda provisional y visible como tal; no prometer Z recuperado definitivo offline.

Orden propuesto en ERP, en una transacción de recepción del Z:

1. Autenticar dispositivo vigente y scope fresco usando protección existente.
2. Buscar cierre por identidad: mismo ID/hash **ya aceptado** devuelve resultado persistido sin reaplicar, aunque después avanzaran revisiones; mismo ID/distinto hash →409. Un cierre legado ya recibido se reconoce como tal sin convertirlo en cierre exacto autorizado.
3. Para cierre nuevo, comprobar expected scope/originals/membership/close/series revisions y epoch/sello/activationId candidato; con bloqueo compartido por terminal y series afectadas. Diferencia →409 CUT_CHANGED antes de aceptar/aplicar/consumir números.
4. Persistir aceptación+manifiesto+IDs y evento correspondiente atómicamente. Aplicación comercial posterior conserva su propia idempotencia/estados. Aceptado/recibido nunca equivale a aplicado.

**Esto precisa la propuesta R3:** reintento de cierre ya aceptado con mismo hash no debe fallar por cambios posteriores del corte, ni repetirse la aplicación. Una activation repetida no equivale a aceptación de Z: auth fresca, estado actual y revalidación al cierre siguen obligatorios.

Productores POS participantes: cobro directo/durable y fallback, devolución e historial original, Collection y anticipo, cash IN/OUT, fiscal upserts, Z/repetición/archivo, sincronización/importación LAN y cambios de serie. ERP debe enumerar recepción directa/batch/genérica, productores marketplace/administrativos que afectan el mismo ámbito y asignación de series. Cambios de efectos ERP (solo status/applied sin contenido) se observan aparte; cambios de original/membresía/serie/scope/otro cierre invalidan corte. Configuración usada por cálculo debe congelarse/hash: cambio retroactivo de esa configuración requiere revisión también.

No basta añadir lock al endpoint activation: todos los escritores relevantes deben participar. Tests de dos conexiones, ACK perdido, crash y takeover necesarios antes de aceptar el protocolo. No se modifica takeover; la autorización vigente y su invalidación se reutilizan.

## 8. Decisión POS sobre reservas perdidas (propuesta)

Identidad local real `FiscalAllocation`: id,terminalId,fiscalRangeId,ncfType,reservedStart,reservedEnd,nextNumber,status,releasedAt,prefix/metadata. `LocalFiscalBuffer`: allocationId/fiscalRangeId/terminalId/startNumber/endNumber/currentNumber. Se exportan definiciones y deben vincularse al contexto company/tenant del envelope.

`utils/db.ts:1381` requestFiscalBatch calcula start=max(reservedStart,nextNumber,historyNextNumber) y persiste buffer/avance local. **No prueba números libres si se perdió el historial local**. No ejecutar durante importación ni recuperar nextNumber usando solo conteos/max visible.

Decisión: cuando no se prueba límite de uso, apartar como **no reutilizable** el intervalo completo reservado [reservedStart,reservedEnd] de la época perdida. No marcar todos sus números como documentos emitidos; distinguir cuarentena administrativa de emisión fiscal. Si ni la reserva completa es conocida, bloquear nueva numeración de esa serie. next remoto nunca demuestra disponibilidad.

Reanudar solo tras confirmación ERP de reserva válida no solapada, asignada a terminal/tipo/empresa correctos y validada bajo transacción contra otras reservas. No basta poner end+1 sin comprobar límites globales y otros bloques. Combinar max(localNext,remoteNext,knownUsed+1) solo dentro del bloque nuevo/válido; no retroceder ni reutilizar el bloque perdido. Serie interna sin reservas necesita mecanismo seguro ERP de asignación/avance exclusivo; no fallback `zReports.length+1`.

**Pendiente ERP:** identificar operación concreta existente de cuarentena/reasignación y garantía concurrente. La existencia del tipo de reserva no acredita ese mecanismo. Se propone utilizarlo si está validado; si no existe, deberá diseñarse aparte y ninguna numeración se habilita aún. Importar un Z/factura existente no pide bloque ni consume número ni llama al proveedor.

## 9. Respuestas finales a los 11 puntos R3

1. Definiciones exportadas textualmente + índice de campos; carencias de perfiles arriba.
2. Pares por emisor y diferencias JSON path entregados; Collection/Advance sin emisor demostrado, payload=null; directo distinto de batch.
3. Date/string/epoch y adaptación ISO comprobados; Allocation literal; nunca sintetizar fecha al recuperar.
4. Normal STORE_CREDIT/CARD y CARD_VOID documentados; CASH/multimoneda de devolución no validados. F04=1050 diagnóstico.
5. Original antes/después y fiscal upsert entregados; sin revisión remota durable probada; VOID comercial pendiente.
6. Collection con dos allocations y anticipo Collection; wallet firmado y referenceId ambiguo documentados; dependencias cerradas read-only.
7. Reloj de cierre solo abonos solo recuperable si estaba persistido en Z; instante perdido no recuperable.
8. Manifiesto v1 y transacción local propuestos; no legacy sintético.
9. Conjunto/época/sello propuestos; época nueva no certifica cola anterior.
10. CAS final e idempotencia de aceptación precisados; offline provisional; productores/locks pendientes de ratificación ERP.
11. Reserva perdida apartada sin afirmar emisión; nueva reserva no solapada requiere mecanismo ERP validado.

Concordamos desde POS con el enfoque de R3, con las diferencias explicitadas. **No hay acuerdo bilateral final ni recuperabilidad certificada.** Requerimos respuesta ERP a mapping de tipos/versiones, escritores que participan del CAS, materialización/retención, vínculo wallet histórico y procedimiento de reserva. No se solicita cambiar el cálculo actual.
