# POS J6 — revisión ERP J5 y cierre del alcance documental

Entrada ERP: commit `7a0447c8`, PR CLIC-ERP #2007, paquete pos-recovery-erp-j5-7a0447c8.zip. Leído primero response-j5.md. Base POS `dfb2b13` (merge J5). **Solo documentación y pruebas offline. Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.** Sin journal, endpoints, migraciones, cálculo, producción, dispositivo ni ventas/cierres de prueba. Se reutiliza pairing/takeover.

## Resultado

SHA256SUMS, runner completo recibido y verify-j5.mjs pasan. Confirmados 186 negativos independientes con hashes recalculados, 16 bindings, cuatro positivos históricos y 16 positivos semánticos ERP. No discrepancia reproducible en los comandos ejecutados. Los tres hallazgos quedan cerrados exclusivamente en el subperfil documental: agregado REFUND, bloqueo TRACKED y DOP explícito con cambio positivo. No se cambia el verificador semántico ni los vectores históricos en J6.

Evidencia POS añadida: inventario AST read-only regenerado de types.ts en la base actual, idéntico al publicado J3: 156 declaraciones alcanzables, 16 con formas abiertas. No son 156 schemas completos: any/unknown/extensiones siguen pendientes. source-evidence.json fija commit, SHA256 y extractos de siete archivos operativos, sin ejecutarlos. verify-review.py puede contrastarlos con git mediante --source; sin esa opción el paquete solo comprueba consistencia interna, no autenticidad de origen.

Hallazgos estáticos que explican prioridades: sourceIdentity.ts contiene redondeo a 2 y 4 decimales y adaptación de timestamp con fallback a fecha actual; no convertir esos fallbacks en reglas de recuperación. App.tsx handleZReport recibe reportData:any y toma declaración/esperado por moneda de ese objeto; openedAt usa transacciones/movimientos y fallback now, sin demostrar sesión durable. erpOutboundPayloads.ts normaliza antes de enviar; payload derivado no sustituye original local completo. AgendaService conserva bookingActivityId en Collection. ZReportReceipt formatea a dos decimales: presentación no es política universal de precisión. Los extractos no son cobertura transitiva de todas las lecturas.

## Ocho acuerdos

| # | Tema | Estado POS | Criterio pendiente / responsable |
|---|---|---|---|
| 1 | Intención/IDs/perfiles | Aceptación provisional v2; evidencia pendiente | POS perfiles completos/commit por backend; ERP identidad durable y precondiciones |
| 2 | Control/retención | Aceptación provisional técnica | Z/control fuera del prefijo, sin purga por ACK; ERP archivo/lookup, POS conservación, operación política |
| 3 | acceptanceDigest | Aceptación provisional J2 | Auth fresca, lookup existente antes del CAS nuevo, unicidad closeId/closeEventId; ERP índices/transacción/replay durable pendientes |
| 4 | Nombres de corte | Cambio necesario | Nueva versión discriminada proposedThrough/progreso y sealedThrough/final, rechazo de mezclas por POS/ERP; R4 intacto |
| 5 | UTF-16/JCS | Aceptación provisional para vectores | POS/ERP parser raw, claves duplicadas, corpus general Unicode/números y biblioteca pendiente; fixtures no son implementación certificada |
| 6 | Captura/configuración/semántica | Cambios y evidencia pendientes | POS prioridades P0/P1 siguientes; ERP almacenamiento íntegro por canal |
| 7 | Registro confiable/archivo | Aceptación provisional del contrato | ERP fuente autenticada independiente, revisión estable, archivo verificable; operación disponibilidad; POS comprobación futura |
| 8 | Canales/CAS/reservas | Evidencia pendiente | ERP receptores/guard/reservas; POS productor y atomicidad; operación resolución/custodia |

## Evidencia POS priorizada y condición de cierre

Estas son tareas documentales y criterios de aceptación, no autorización de implementación. P0 bloquea incluso el alcance inicial; P1 bloquea las variantes ampliadas. Cada entrega debe fijar commit/canal/versiones, indicar campos preservados/perdidos/desconocidos y aportar casos independientes. No basta cerrar más negativos aislados.

| Prioridad | Evidencia requerida | Fuente de partida | Entrega concreta y condición de cierre |
|---|---|---|---|
| P0-1 | Perfiles originales por canal | types.ts, sourceIdentity.ts, erpOutboundPayloads.ts, ApiSyncAdapter.ts; inventario J3 y pares R3 históricos | Matriz local→directo→batch→receptor, por Transaction/items/payments, CashMovement, Collection/allocations/Advance, wallet y Z. Schema completo versionado, campos opcionales/ausentes/null/unknown y timestamps explícitos; ninguna pérdida relevante sin resolver. ERP confirma persistencia original, no solo documento comercial |
| P0-2 | Precisión/rounding | sourceIdentity.ts, calculadores y productores de pago | Tabla por campo/moneda/unidad: representación, escala, momento y modo de redondeo, conversión y tratamiento del cambio. Oráculo nativo aislado de efectos con valores frontera y comparación independiente. Tolerancia 1e-8 de fixtures no es política acordada |
| P0-3 | Configuración histórica y lecturas | handleZReport, analytics, zReportPaymentSummary, orderServiceType, capture-profiles J3 | Tipos de los 14 bloques, valores efectivos, versión/hash/resolver y mapa transitivo lectura→campo capturado. Registrar dependencias de reloj/locale/orden. VALUE arbitrario no basta; cobertura instrumentada offline pendiente. Ausencia de dato que impacta resultado bloquea exactitud |
| P0-4 | Declaración/apertura | reportData recibido por handleZReport y su productor UI | Tipo cerrado por método/moneda, fondo/retiro, denominaciones, políticas y valores efectivamente confirmados por operador. Distinguir efectivo físico por moneda de equivalente convertido. No inventar declaración/openedAt con configuración o reloj actual |
| P0-5 | Z y anexos | handleZReport, tipos ZReport, renderer ZReportReceipt | Selección y orden exactos, entradas/salidas y anexos completos versionados; comparación nativa aislada con iguales importes, IDs y relaciones, incluyendo medianoche y documentos cerrados como dependencias. Ninguna venta reabierta ni revisión histórica sumada |
| P0-6 si incluye reimpresión | Impresión | ZReportReceipt y dependencias de renderer/activos | Captura de layout/renderer/activos/locale/opciones y comparación de salida. Si no se prueba, reimpresión exacta queda explícitamente excluida; no confundir igualdad monetaria con igualdad visual |
| P1 | Variantes complejas | Productores específicos y configuraciones históricas | FX/impuestos/descuentos/crédito/modifiers/UOM/recetas/TRACKED, CASH refund/VOID comercial, wallet creación/cashback y multiserie: perfiles propios completos antes de ampliar el alcance |

Propuesta para terminar la fase: acordar primero un alcance inicial limitado al candidato simple DOP, sin impuestos/descuentos/crédito, inventario NONE probado por política y una serie. Esto NO está listo: exige P0-1 a P0-5 y evidencia ERP/operación; si no pueden acreditarse se bloquea, no se redefine el dato. Decidir explícitamente si reimpresión exacta pertenece a la primera entrega. ERP debe devolver una lista consolidada de bloqueantes con dueño/evidencia exigida; POS completa esos paquetes antes de pedir autorización de implementación. No estimar avance por cantidad de fixtures que pasan.

## Variantes y límites

| Variante | Estado actual |
|---|---|
| Venta simple DOP/tasa1, cambio positivo DOP explícito, impuesto/descuento cero | Soportada solo por evaluador documental; procedencia, política NONE y equivalencia nativa no demostradas |
| REFUND CARD/STORE_CREDIT, límite agregado | Relaciones sintéticas comprobadas; límite auténtico/actual y exclusión concurrente pendientes. VOID comercial/proveedor no demostrado |
| TRACKED, FX de pagos, impuesto/descuento, crédito, métodos no admitidos | Bloqueados por evaluador; no cambiar TRACKED a NONE ni aplicar defaults para pasar |
| Collection/Advance simple | Coherencia de cantidades/allocations/heads limitada; canales, precisión y aplicación ERP pendientes. Advance usa bookingActivityId; con allocations queda fuera |
| Wallet existente con vínculo / Cash IN-OUT / revisión fiscal | Solo comprobaciones parciales de forma/relaciones. No prueba autoridad de saldo, efectivo disponible o proveedor. Creación wallet/cashback/sin vínculo fuera |
| CLOSE_SET y configuración | Binding/selección y parte de declaración; DECLARED_NOT_PROVEN y readCoverage NOT_PROVEN. No cierre exacto autorizado |
| Conversión UOM/recetas, impresión completa, perfiles desconocidos | No demostrados y fuera del alcance certificable; no afirmar que el evaluador detecta universalmente todas sus representaciones |

## Intención v2 y series conservadas

executionContext obligatorio y closeControl exacto con closeId, closeEventId, nextOpenSetId congelados antes del hash. Prepararlos no crea Z, no consume número ni activa conjunto. Efectos/resultados/números/relojes/membresía/control/outbox/siguiente conjunto solo en futuro commit atómico. Reintentos mantienen IDs/contenido/resultado; mismo commandId con intención diferente es conflicto. Unicidad/atomicidad durable pendiente. Sin traducción silenciosa de v1.

| Comando | expectedSeries | Purpose |
|---|---|---|
| SALE_CREATE | 1 | TICKET |
| REFUND_CREATE | 1 | CREDIT_NOTE |
| COLLECTION_CREATE | 1 | PAYMENT_IN |
| BOOKING_ADVANCE_CREATE | 0/1 explícito | NONE con razón/resolver o ADVANCE_RECEIPT |
| CASH_CREATE | 0 | Sin emisión en esta variante |
| WALLET_POST | 0 | Sin emisión en esta variante |
| FISCAL_REVISION | 0 | Revisión del documento |
| CLOSE_SET | 1 | Z_REPORT |

reservationId=null declara INTERNAL_EXCLUSIVE, requiere prueba ERP de propietario/ámbito/exclusividad/revisión/límites. No significa reserva perdida, disponibilidad o permiso. RESERVED requiere reserva durable emitida al ámbito. Allocation/expectedSeries exactos, start<=next<=end, avance 1; end+1 posterior es agotamiento. No retroceder ni usar máximos/conteos como disponibilidad. Multiserie bloqueada: no dividir ticket+NCF para eludir control conjunto; necesita perfil y evidencia propios.

## Responsabilidades que no se sustituyen con fixtures

**ERP:** recepción original Collection/Advance y wallet independiente, sin reaplicar pagos; CAS común para todos los escritores directos/batch/RPC/admin/series/config; cuarentena del intervalo fiscal perdido completo sin declararlo emitido; reasignación atómica sin solapamientos; series internas exclusivas ligadas al resultado idempotente. SELECT previo no prueba exclusión y release no prueba cuarentena. ERP debe aportar raíz autenticada independiente del ZIP/request, registryRevision estable, archivo íntegro y lookup activo/archivo/tombstone coherente.

**POS:** perfiles/evidencia nativa anteriores, conservación de IDs/relaciones y estados recibidos/pendientes/fallidos/aplicados, separación de cola local y datos restaurados. Commit real por backend y descarga/importación idempotente se demostrarán en una fase autorizada, no en esta revisión.

**Operación:** custodio, plazos por clase, disponibilidad/costos/copias, RPO/RTO, bajas y política de retención/eliminación. 24h/7d siguen propuestas. TTL de descarga no elimina identidad/digest de deduplicación. Tombstone reconoce identidad/conflicto, no reconstruye archivo; sin contenido ARCHIVE_UNAVAILABLE. No GC de deduplicación sin corte irrevocable demostrado para épocas/IDs antiguos.

Registro/archivo/tombstones/autenticidad remota/continuidad durable NO demostrados. resumeAnchor pos.journal.resume.v1 sigue provisional. SAME_EPOCH_SUFFIX necesita continuidad real de base/contador/prefijo, no UUID coincidente; NEW_EPOCH no recupera una cola perdida. No fallback al hash del propio paquete si falla la raíz independiente. ACCEPTED técnico puede coexistir con aplicación FAILED; mantener ambos visibles y no reaplicar. Prefijos/conteos coincidentes no prueban operaciones que nunca salieron del dispositivo.

## Reproducibilidad

Desde ZIP POS J6 extraído, Python con jsonschema 4.25.1 y Node:

```sh
shasum -a 256 -c SHA256SUMS
python3 docs/pos-recovery-j6/verify-review.py inputs/pos-recovery-erp-j5-7a0447c8.zip
```

En checkout POS con historial git añadir --source para contrastar extractos contra commit fijado. Regeneración AST read-only: NODE_PATH apuntando al node_modules POS, `node docs/pos-recovery-j3/export-native.cjs`; comparar JSON con native-closure.json J6. No cargar app ni servicios. results.json conserva salidas ERP; historical-sha256.json fija JSON publicados. El ZIP ERP se distribuye en el artefacto J6, no se añade otra copia binaria al repositorio.

No cambios de verificadores semánticos por ausencia de nueva discrepancia. Se añade solo verificador de revisión/evidencia. Pruebas offline y git diff --check; build/lint de runtime no corresponde. **Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.**
