# Especificación de originales POS y comparación con fixtures ERP

Estado: **propuesta validada localmente en los casos indicados; no restaurador ni contrato de cierre aprobado**.
Fecha: 2026-09-06. Rama desde origin/develop `4d5710875c352af367f2f82701e80102060dd68a` (incluye PR #554). No hay diferencia en App.tsx, types.ts, paymentSettlement, analytics, ZReportDashboard o localRefundPersistence respecto a la auditoría `5993b1f`. Alcance exclusivo CLIC-POS.

## Entrega y alcance de la validación

- `originals.schema.json`: proyecciones operacionales mínimas propuestas para validar datos de recuperación. **No** reemplazan los tipos completos de la aplicación, no certifican membresía/cobertura ni son todavía un esquema acordado con ERP.
- `fixtures.json`: ocho entradas artificiales, separadas de los paquetes ERP, con resultados esperados. No se generaron ventas/cierres en ninguna base. El ejemplo Z es solo de forma; su declaración es ficticia y no un conteo físico.
- `verify-pos.cjs`: ejecuta helpers puros y extrae literalmente los bloques de efectivo del dashboard y openedAt de handleZReport. No carga componentes React, DB, workers ni persistencia de devoluciones. Registra hashes del código leído y verifica que no se muten los fixtures.
- `results.json`: resultados de esa ejecución sobre el commit declarado. No son resultados de restauración ni prueba de UI completa, selectores, aislamiento, reimpresión, HTTP o concurrencia.
- `verify-schema.py`: comprueba 21 proyecciones de originales y negativos de originales vacíos/campos ausentes. Las relaciones y aritmética de allocations se comprueban en el verificador POS, no mediante JSON Schema.
- `ERP_HANDOFF.md`: respuesta autocontenida para devolver al ERP.

Los ZIP ERP 18afe450 y 95365dc8 contienen los mismos artefactos salvo BUNDLE.txt. Su verificador de schema pasó 42 envelopes/6 negativos; el de fixtures pasó 4 paquetes de descarga + 1 candidato separado. Esta entrega complementa esos resultados, no edita archivos del ERP.

## Tres capas que no deben confundirse

1. **Original local:** documento que está en transactions/transactionHistory, cashMovements, collections o zReports. Tiene IDs, propiedades operacionales y a veces campos maestros heredados de Product.
2. **Original recibido por ERP:** ya pasó por sourceIdentity y erpOutboundPayloads. Conserva parte del documento local, pero no es backup byte a byte. Nunca reconstruir desde erp_sales_documents.
3. **Proyección para recuperación:** estructura explícita y validada que conserva todas las propiedades recibidas, detecta carencias y aporta alcance/procedencia. No hacer cast a Transaction/CartItem ni rellenar el original con defaults inventados.

additionalProperties=true permite preservar campos desconocidos; **no** autoriza eliminarlos. Los required del esquema nuevo son mínimos propuestos, en algunos casos más estrictos que los opcionales históricos de types.ts. Un registro legacy que no los cumpla permanece como evidencia con limitaciones; no se descarta ni se “arregla” con nombre/moneda/hora actuales. Separar aptitud para copia, cálculo, reimpresión y futura nueva operación.

## Requisitos por tipo

| Tipo / evidencia POS | Identidad y campos operacionales | Ausencia/adaptación |
|---|---|---|
| Transaction (`types.ts:1763`) | id y source_* originales; displayId/seriesId/seriesNumber si fueron emitidos; date, terminalId y contexto canónico corroborado, userId/userName, documentType/status, items/payments/total; taxAmount/netAmount/taxBreakdown, descuento y política incluida/exenta; settlement* y fiscal/relaciones originales | El esquema exige clasificación para versión nueva, aunque documentType sea opcional en tipo legacy. Sin clasificación/contexto verificados: evidencia UNKNOWN. No inferir moneda base desde primer pago extranjero. Sin desglose fiscal/configuración histórica: no certificar cálculo fiscal/reimpresión. |
| CartItem (`types.ts:1704`, Product :1484) | **id es ID de producto; cartId es identidad de línea**, no sustituir uno por otro. name/quantity/price; precio original, descuentos, importes/tasas/impuestos aplicados; variantId/Sku/Info, tracking*, promoción, selected_modifiers/fractions/combo y notas cuando existan | Los fixtures ERP ponen id=line-1/productId=... y omiten cartId: no equivalen automáticamente al tipo POS. ERP debe conservar identidad de producto y línea por separado. No inventar cartId a partir del índice para originales históricos. |
| Maestros heredados de Product | category/images/attributes/variants/tariffs/appliedTaxIds aparecen requeridos por el tipo completo | images/attributes/variants/tariffs y otras definiciones se eliminan en el emisor. No son todos indispensables para caja; NO exigir reconstrucción del catálogo para copiar un documento. El futuro DTO de restauración debe separarse de Product. appliedTaxIds no sustituye importes/tasas históricos. Ninguna tasa/precio se toma del catálogo vigente para certificar historia. |
| PaymentEntry (`types.ts:2358`) | id, method, methodId/Label histórico si existe, amount recibido base, timestamp; currencyCode/amountOriginal/exchangeRate/appliedAmount/changeAmount/changeCurrencyCode y aliases preservados | timestamp de transporte ISO-8601; un Date solo se convierte en una vista local después de validar. Campos monetarios opcionales en legacy no se vuelven cero. El esquema mínimo no demuestra semántica monetaria: si falta moneda/tasa/cambio aplicable, cálculo exacto bloqueado salvo prueba histórica inequívoca. CREDIT no es efectivo recibido. |
| CashMovement (`types.ts:2163`) | id,type IN/OUT,amount,reason,timestamp,userId/userName,terminalId,currencyCode | No usar createdAt/concept summary como sustitutos arbitrarios. Fondo solo con movimiento explícito. Config fixedCashFundAmount no es movimiento. El tipo aún no tiene pertenencia durable al Z. |
| Collection (`types.ts:3023–3058`) | id/displayId,customerId/customerName,date,terminalId,userId/userName,method,moneda/tasa, totalAmount, receivedAmountOriginal/Base, appliedAmountBase/unappliedAmountBase, allocations completas, series y zReport* si existen | La proyección nueva exige importes explícitos; documentos viejos incompletos deben diagnosticarse. sum(allocations.amount)=appliedAmountBase; applied+unapplied=receivedBase; cada allocation.collectionId coincide con recibo; transactionId apunta a referencia exacta. Validar redondeo de la moneda; no usar tolerancia genérica para tapar pérdida. |
| Anticipo agenda (`AgendaService.ts:483–528`) | **Es Collection**, añade bookingActivityId y opportunityId opcional; allocations puede estar vacío. El código actual registra DOP/tasa 1 | No mapear appointmentId a bookingActivityId sin acuerdo/procedencia. ADVANCE puede ser kind de envelope, pero original debe conservar Collection; para cálculo actual llega a collections, no se crea venta. |
| REFUND (`App.tsx:10650–10700`, `localRefundPersistence.ts:28–70`) | Transaction con documentType REFUND, status REFUNDED, total y cantidades positivos; originalTransactionId, affectedInvoiceNumber/NCF, moneda/pagos originales | El flujo normal usa STORE_CREDIT; tarjeta usa CARD y gatewayTransactionType VOID/REFUND. No invertir signos ni crear CASH para compensar. Conservar estado de la venta original como otra revisión, no volver a aplicar saldo/inventario. |
| VOID | `TicketHistory.tsx:2352` y App manejan CARD_VOID como devolución documental | CARD_VOID no equivale al objeto standalone `{status:VOID,transactionId,...}` del fixture ERP. No hay esquema nativo general de tombstone acordado; el schema de esta entrega deliberadamente no lo inventa. Un VOID comercial distinto necesita caso/original/versionado específicos. |
| Wallet | Wallet propio y uso STORE_CREDIT no son por sí solos Collection | No se aprueba aquí el objeto WALLET reducido del ERP como backup completo. Exigir emisor y documento original exactos, balance/revisión/dirección/relaciones; saldos son efectos, no nuevos ingresos. Queda pendiente de contrato por canal. |
| ZReport (`types.ts:2947`) | id/terminalId/sequenceNumber; openedAt/closedAt, closedByUserId/Name; baseCurrency,totalsByMethod,cashExpected/cashCounted/cashDiscrepancy,cashSales/In/Out,transactionCount,notes; conservar stats, declarations, details, tax summaries y demás campos si existen | declaredTotals/systemTotals agregados ERP no sustituyen mapas monetarios POS. El Z F03 del ERP no tiene forma nativa completa; solo puede ser referencia hasta aportar originales. Restaurar no fabrica declaración ni emite otro número. |

## Pérdidas explícitas del emisor

`services/sync/erpOutboundPayloads.ts:124–162` elimina attributes, variants, tariffs, images, stockBalances, warehouseSettings, activeInWarehouses y definiciones de modificadores/fracciones/combos, note presets y operationalFlags; sanea referencias de tarifas no UUID. Conserva los demás campos de línea por spread, incluidos cartId y selecciones cuando existen. En modo fiscal NONE elimina campos fiscales específicos (:185).

`services/sync/sourceIdentity.ts:142–199` construye una **proyección** de PaymentEntry. Conserva un subconjunto de gateway, no todo gatewayRawResponse/recibos u otras propiedades locales. También genera ID/hora si faltan. Esa normalización es para envío existente; **prohibido usarla en importación para fabricar historia**. Para pagos legacy sin identidad/hora probadas, devolver limitación y datos recibidos intactos. Revisar campos concretos de pasarela antes de afirmar reimpresión de comprobante integrado.

## Resultados que puede adoptar ERP ahora

| Caso local | Comportamiento real observado |
|---|---|
| P01 moneda (equivalente a F01 monetario) | cashExpected USD +10 / DOP -50. No es DOP +550 físico. Fixture POS usa producto/línea y campos mínimos completos; no pretende validar impuestos/descuentos del F01 ERP. |
| P02 solo Collection | cashExpected `{}`; collectionsTotal 100; openedAt=`fixedNow` del cierre. Un `0` es fallback de presentación, no un bucket presente en el cálculo. |
| P03 devolución normal STORE_CREDIT + fondo | cashExpected DOP 1000; returnsTotal 50. No entrega CASH por la nota de crédito. |
| P04 devolución CARD + fondo | cashExpected DOP 1000; returnsTotal 50; metadata REFUND preservada. |
| P05 anulación CARD_VOID + fondo | Sigue siendo documento REFUND con pago CARD/VOID: DOP 1000 y returnsTotal 50. |
| P06 CASH positivo + fondo | DOP 1050: **caso diagnóstico no aprobado como flujo de reembolso CASH**. La fórmula no resta según documentType. No cambiar expectativa a 950 ni signo del pago durante restauración. |
| P07 anticipo agenda | Collection con bookingActivityId: collectionsTotal 30, cashExpected `{}`, openedAt hora de cierre. No se contabiliza automáticamente en advancementsTotal por ser anticipo de agenda; ese total usa walletDepositAmount de transactions. |
| P08 venta y abono cruzando medianoche | Cash igual a venta; collectionsTotal 100; openedAt primera venta. No hay partición diaria en los bloques ejecutados. Los filtros de terminal/membresía completos no se ejecutan en este harness. |

Se mantienen las discrepancias actuales de abonos y signo CASH como hallazgos. Corregir cálculo o añadir sesión es otra tarea, con versión y pruebas propias. Copiar el original no debe transformar resultados para coincidir con una interpretación nueva.

## Requisitos locales para una futura implementación (todavía no realizada)

- Un DTO de originales recuperados, independiente de CartItem/Product, que conserve payload y limitaciones. Tipos Date/strings deben tener codec explícito, nunca constructor con fallback “ahora”.
- Separar capacidades: copia válida; cálculo comprobable; reimpresión completa; cierre exacto autorizado. Aprobar una no aprueba las demás.
- Staging fuera de transactions/collections activas. Referencias cerradas quedan excluidas del conjunto activo; mismo ID/revisión/hash es repetición, distinto hash es conflicto.
- Escritura de importación atómica sin commitFinancialTransaction/persistStandaloneRefundTransaction. Esos helpers cambian inventario, saldos, cola, historial y disparan sync; no son importadores.
- No habilitar selectores por simple ausencia de zReportId. MEMBERSHIP UNKNOWN siempre permanece fuera del conjunto certificable; las listas de entrada del harness son artificiales, no una autorización de membresía.
- Nuevo manifiesto de Z con IDs/revisiones, previousCloseId, configuración/declaración y persistencia atómica con archivo. No convertir cierres legacy ni modificar su cálculo.
- Log operacional duradero por época con alta/mutación/abono/movimiento/cierre. Secuencia de outbox contable no demuestra totalidad de operaciones locales. El sello final y aceptación concurrente deben acordarse con ERP; ninguna propuesta local puede probar una cola perdida nunca comunicada.
- Snapshots/receipts no autorizan Z. Mantener el protocolo de cierre separado como proponen los paquetes ERP. Reutilizar takeover, no crear un nuevo pairing.

## Reproducción

Desde raíz del repo, con TypeScript instalado según lockfile:

```sh
node docs/pos-recovery-native/verify-pos.cjs
python3 -m venv /tmp/clic-pos-original-schema-venv
/tmp/clic-pos-original-schema-venv/bin/pip install jsonschema==4.25.1
/tmp/clic-pos-original-schema-venv/bin/python docs/pos-recovery-native/verify-schema.py
```

En esta revisión se usó TypeScript disponible en el checkout principal mediante NODE_PATH y jsonschema 4.25.1 en venv temporal. No se añadió dependencia al producto ni cambió lockfile. Solo se ejecutaron cálculos puros; un PASS no demuestra recuperación operacional disponible. Cambios de código que muevan los bloques de extracción requieren revisión de los marcadores y resultados antes de aceptar nuevos hashes.
