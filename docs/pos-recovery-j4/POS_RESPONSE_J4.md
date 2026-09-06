# POS J4 — correcciones J3, intención v2 y reglas semánticas

Base POS origin/develop `0c03f7c`, incluye J3 `5a76ecd`. Entrada ERP `10eef7a1`, PR2005, response-j3.md. **Solo documentación y pruebas offline**, sin journal, endpoints, migraciones, cálculo, datos operacionales o dispositivo. Estado **UNAGREED**; legacy **UNKNOWN**, exactZEligible=false, closeAuthorization=NOT_GRANTED. Las reglas siguientes son propuestas para contraste bilateral, no aprobación de implementación.

## Verificación recibida y discrepancias

SHA256SUMS coincide. Se ejecutaron las tres órdenes de response-j3.md y los cuatro verificadores ERP anteriores: todos PASS. verify-j3 registra ocho positivos y89 negativos. Su reproducción de limitaciones apunta a la copia J3 archivada, que se conserva intacta en el ZIP de entrada. No evalúa el verificador POS corregido.

Los cinco problemas concretos de binding se corrigen en `docs/pos-recovery-j3/verify-contract.mjs` sin modificar intent-contract.json ni contract-vectors.json históricos:

- preparedAt exige forma UTC ms y round-trip exacto ISO: 30 de febrero, 29 de febrero no bisiesto y31 de abril fallan. 29 de febrero bisiesto pasa.
- reservationId no admite vacío ni blancos. null sigue siendo sintaxis válida; v2 añade modalidad/propiedad/límites, no lo interpreta como SAFE.
- artifact exige exactamente schemaVersion/role/document; un extra sigue siendo error aunque el digest sea correcto.
- en los cinco roles Draft nuevos se rechazan campos asignados al commit, también anidados. Se rechaza, no se borra. Los antecedentes históricos en roles separados quedan íntegros, incluidos seriesNumber/closedAt.
- anclaje exige domain pos.journal.resume.v1, modo NEW_EPOCH o SAME_EPOCH_SUFFIX, conjunto distinto, y relación correcta entre épocas. Eso no prueba continuidad física ni autenticidad.

Lista de campos prohibidos en drafts: journalSequence,newRevision,chainHash,displayNumber,displayId,sequenceNumber,seriesNumber,closedAt,openedAtFallback,manifestHash,sealHash,acceptanceDigest,transportAttempt,activationId. Se aplica recursivamente al **perfil de draft nuevo**, no al JSON original recuperado ni a originalBefore/documentsBefore/walletBefore/linkedDocument. Si un snapshot histórico se necesita, se referencia por el rol de antecedente: no se incrusta como draft y después se depura. Un nuevo perfil que necesite un campo homónimo legítimo deberá declararlo/versionarlo; esta validación no autoriza mutar lo observado.

## 1. Intención v2 y momento de asignación de IDs

`intent-contract-v2.json` mantiene ocho comandos, ahora **version=2** y domains `pos.intent.<comando>.v2`, con perfiles por rol `.j4`. Todos añaden executionContext. CLOSE_SET añade closeControl. V1 queda como binding archivado: no se transforma ni se aprueba para ejecución por haber pasado antes. No se modifica R4 ni sus nombres de corte.

`closeControl.document = {closeId,closeEventId,nextOpenSetId}` exacto. Los tres son UUID distintos, asignados una sola vez **durante preparación, antes de intentHash**, al igual que commandId. nextOpenSetId no puede ser el conjunto actual; closeId no puede reutilizar el cierre anterior. El artifact tiene schemaVersion `pos.intent-artifact.closeControl.j4` y role closeControl. Su hash liga los tres IDs a la intención. Cambiar cualquiera produce otro intentHash, comprobado en tests.

Los IDs preparados aún no crean cierre ni abren conjunto. El commit debe revalidar precondiciones y guardar atómicamente el control, Z/manifiesto/sello/serie/membresía/outbox/resultado y el siguiente conjunto. El resultado utiliza esos mismos IDs, no genera otros. Fallo antes del commit no habilita nextOpenSetId; retry del mismo comando conserva los IDs. Otro contenido con commandId ya confirmado es conflicto. Consulta por comando tras pérdida de ACK debe devolver el resultado persistido, sin volver a emitir ni consumir número.

| Se fija antes de intentHash | Se asigna dentro del commit una sola vez | Se mantiene fuera de la identidad de intención |
|---|---|---|
| commandId, IDs técnicos de drafts/pagos/allocations, preparedAt, closeControl, heads, planes/configuración, expectedSetRevision y expectedSeries | número de serie permitido, revisión operacional/posición, closedAt y openedAt fallback del cálculo vigente, hashes finales/resultado, publicación del próximo conjunto | lease/retry/estado de impresión, activationId del intento HTTP, ACK/aplicación comercial |

Los valores ya emitidos de un antecedente no se reasignan. Z/control no ocupa posición dentro del prefijo que sella. closeEventId se reutiliza en outbox técnico y aceptación; la unicidad de closeId y closeEventId se controla por separado. Identidad del comando e identidad de aceptación de cierre continúan siendo dos niveles.

## 2. expectedSeries, null y antecedentes por comando

executionContext liga scope, resolverVersion, inventoryMode y numbering. numbering tiene exactamente mode,reason,allocations. Mode NONE exige allocations=[] y reason `<COMMAND>_NO_NUMBER`; se requiere evidencia del resolver/configuración que originó esa decisión. NUMBERED exige reason=null y correspondencia uno a uno con expectedSeries.

Cada asignación declara seriesId,reservationId,purpose,scope,mode,revision,next,start,end,advance. Coinciden ámbito/serie/reserva/revisión/next con la intención, start<=next<=end y advance='1'. expectedSeries se ordena por seriesId único; IDs de serie/reserva son cadenas no vacías, **no se presume UUID**. Null solo corresponde a modo INTERNAL_EXCLUSIVE con estado exclusivo de serie interna y revisión/límites comprobables; string a RESERVED con reserva emitida y propietario correcto. Los tests comprueban relaciones declaradas: la exclusividad/reserva real requiere evidencia y CAS, no un campo mode autodeclarado.

| Comando | Regla de numeración de este candidato | Antecedentes/planes obligatorios |
|---|---|---|
| SALE_CREATE | Una serie TICKET obligatoria | saleDraft, inventoryPlan incluso NONE explícito, paymentEvidence; executionContext histórico/resolver. Cliente/deuda/head adicionales obligatorios si crédito afecta deuda: fuera del subperfil ejecutable simple, bloqueado hasta perfil propio |
| REFUND_CREATE | Una serie CREDIT_NOTE obligatoria | refundDraft, originalBefore con líneas/cantidades restantes, inventoryPlan, refundEvidence con proveedor/método/disposición. CASH/multimoneda y VOID comercial no admitidos |
| COLLECTION_CREATE | Una serie PAYMENT_IN obligatoria | collectionDraft, allocationPlan, documentsBefore exactos para todas las referencias, customerBefore; no falta un head por estar el documento cerrado |
| BOOKING_ADVANCE_CREATE | [] solo NONE explícito; si numerado, una serie ADVANCE_RECEIPT | Collection con bookingActivityId, bookingBefore y customerBefore coherentes. **allocations=[] y appliedAmountBase=0**; no permite asignación a facturas sin otro perfil con plan/heads completos |
| CASH_CREATE | [] obligatorio; no consume serie documental en este perfil | cashDraft completo con identidad/tipo/moneda/operador/motivo/fecha; apertura debe ser movimiento observado, no fondo configurado |
| WALLET_POST | [] obligatorio | walletDraft, walletBefore y linkedDocument. Este candidato exige vínculo resuelto; ausencia genérica de link no se aprueba. Casos independientes sin vínculo necesitan variante tipada y evidencia propia |
| FISCAL_REVISION | [] obligatorio; no solicita nuevo NCF | originalBefore y fiscalResult observados; no vuelve a emitir ni permite sustituir importe/documento/proveedor |
| CLOSE_SET | Una serie Z_REPORT obligatoria | memberSelection/configuration/declaration/previousClose, executionContext y closeControl; no fallback zReports.length+1 |

**Límite explícito:** v2 aquí permite a lo sumo una serie por comando. Venta que requiere ticket interno y otra reserva fiscal simultánea, creación wallet sin head previo, crédito con plan de deuda, anticipo con allocations y cualquier variante no cubierta deben devolver UNSUPPORTED_PROFILE antes de autorizar. No emitir parcialmente ni suponer que la única serie cubre la otra. ERP debe ratificar o ampliar las variantes con roles/resultados explícitos. Esta decisión cierra qué significa [] en el candidato, sin rediseñar la numeración vigente.

## 3. Reglas semánticas de los perfiles y condiciones de rechazo

Se separan tres capas: (A) forma y binding/hash, (B) coherencia semántica por perfil/canal, (C) prueba de origen/cobertura/atomicidad/aceptación. Pasar A o los ejemplos de B no habilita C. `semantic-vectors.json` aporta contenido de negocio sintético; ya no son solo fixtureOnly/label. No pretende ser catálogo completo de todos los tipos nativos abiertos.

### Comunes

Head completo: scope,kind,id,revision,originalContentHash,storageEpoch,openSetId,sequence,snapshot. ID coincide con snapshot.id; revisión positiva y posiciones decimales; hash se recomputa con la preimagen R4 de ocho campos, no H(snapshot) aislado. El antecedente debe provenir del archivo/registro confiable; este test solo verifica su coherencia interna. Una identidad conocida no se recrea con revisión1/null. Fechas capturadas siguen su perfil de canal; preparedAt nuevo UTC ms exacto no normaliza fechas históricas. Propiedades nativas desconocidas se conservan para archivo, pero requieren clasificación para capacidad exacta. Sin validador/regla para un campo con impacto, UNSUPPORTED_PROFILE/UNKNOWN, nunca default arbitrario.

Operaciones nuevas deben llevar terminal canónica/ámbito verificados; no se usa alias como autoridad. Captura de PaymentEntry debe distinguir amount recibido/aplicado y cambio por moneda, no convertir arbitrariamente al efectivo base. Operador/cliente/producto/línea/pago son identidades distintas. Moneda ausente o tasa histórica desconocida bloquea exactitud. El archivo original no se limpia ni se completa desde maestros actuales para hacer pasar una validación.

### Transaction y pagos

Exigir id/tipo/estado/fecha/operador/terminal, renglones cartId únicos, id de producto separado, cantidad/unidad/variante/modificadores, todos los importes/impuestos/descuentos históricos y PaymentEntry por ID único. Totales y liquidación deben coincidir con las salidas **del cálculo POS versionado vigente** para esa representación (incluido taxIncluded, precio/discount por línea y FX/cambio); no introducir una fórmula alternativa simplificada como validador universal. Cero pagos válido únicamente con perfil explícito de crédito/deuda/anticipo que explique saldo y efectos; no se acepta por ser array vacío.

El plan de inventario debe cubrir exactamente las líneas que afectan stock, con cantidad/unidad/almacén/variante/signo y expansión de receta/UOM versionada; modo NONE exige fuente de política que lo justifique. Reconciliación de pago requiere ID de pago/intent/proveedor y resultado previo: AUTHORIZED no prueba commit local, UNKNOWN bloquea reintento de cobro. paymentEvidence no crea un segundo ingreso. El subperfil ejecutable de venta usa DOP, tasa1, impuesto/descuento cero y exige sumas de línea/aplicación/cambio coherentes; rechaza crédito, FX e impuestos/descuentos fuera de ese subperfil. No se usa esa fórmula simple para validar ventas generales: equivalencia de importes complejos requiere el oráculo nativo y no está certificada aquí.

REFUND es NC nueva positiva con originalBefore de TRANSACTION del mismo ámbito y referencias a líneas originales, límites restantes descontando NC previas. CARD requiere disposición REFUND o VOID y resultado proveedor vinculado; STORE_CREDIT requiere disposición STORE_CREDIT y plan de saldo/deuda correspondiente. El fixture CARD solo comprueba referencias/límite/método: no simula proveedor. CASH, multimoneda, VOID comercial y NC sin antecedentes validados siguen bloqueados. Venta cerrada referenciada nunca se añade como nuevo miembro monetario.

### Collection/Advance

Cliente del draft, customerBefore, documentos y booking debe coincidir. Cada allocation tiene ID único, collectionId correcto, transactionId presente en documentsBefore y cantidad positiva. Heads sin duplicados, sin omisiones y sin extras; mismo ámbito/cliente; suma por documento no excede pendingBalance comprobado. allocationPlan debe coincidir exactamente con allocations, no reconstruirse por fecha. Sum(allocations)=appliedAmountBase; recibido base=aplicado+no aplicado; totalAmount corresponde a recibido base en este perfil; recibido original*tasa debe corresponder al valor base bajo la precisión/redondeo **versionados del emisor**. Las tolerancias 1e-8 de los fixtures solo comparan su aritmética simple, no definen política monetaria de producción.

Estado/deuda posterior es resultado del comando legítimo, nunca del importador. Advance exige BOOKING real y bookingActivityId/customerId coherentes; este perfil no admite allocations. Si no hay head de cliente/Activity ni evidencia histórica, bloqueo. Series obligatorias/opcionalidad según tabla, no ID ANT por reloj como prueba de reserva.

### Wallet/Cash/Fiscal

Wallet: head WALLET existente con saldo/cliente/moneda históricos; PAYMENT negativo, DEPOSIT/REFUND positivo, importe finito no cero. Vínculo resuelto a documento del mismo cliente/ámbito, manteniendo referenceId literal (puede ser displayId). Saldo resultante no negativo según precisión del emisor; cashback/creación sin head u otros tipos requieren variante y no pasan este candidato. Evitar sumar wallet y PAYMENT_POSTED/STORE_CREDIT otra vez.

Cash: IN/OUT explícito, importe positivo finito, currencyCode/fecha/operador/motivo. Fondo inicial requiere documento operacional observado, no fixedCashFund. OUT necesita evidencia del saldo disponible por moneda/corte conforme al comportamiento vigente; el fixture no certifica ese saldo. No invertir signo al recuperar.

Fiscal: head TRANSACTION, proveedor/identidad y referencia anterior preservados; observación original con fecha válida. Patch candidato limitado a fiscalStatus,fiscalReference,fiscalMessage,fiscalSyncedAt; cualquier total/items/payments/id/NCF/proveedor nuevo requiere otro protocolo y se rechaza aquí. Tipos/uniones exactos de cada campo deben fijarse con el canal fiscal observado antes de aprobar esa variante. Importación jamás ejecuta proveedor ni reemite SALE.

### Configuración/declaración/Z/impresión

Los14 bloques de J3 se representan sin ambigüedad como `{state:'VALUE'|'NULL'|'ABSENT',value}`. NULL/ABSENT exigen value=null, pero conservan estados distintos; VALUE debe validar contra el tipo del bloque, no puede significar «desconocido». sourceVersions contiene hashes de selector/helpers/resolvers; currencies y paymentMethods son listas en orden con IDs/códigos únicos, baseCurrency resoluble; tasas positivas, impuestos/políticas históricas, opciones efectivas por operador y entorno. No guardar credenciales de integración/email ni suponer configuración actual.

calculationInputOrder contiene exactamente listas tipadas de miembros/revisiones seleccionadas, sin dependencias/duplicados/omisiones; resumeAnchor se verifica contra registro independiente o PROVEN_FIRST durable. readCoverage debe acreditar todos los accesos reales por helper/sección; `DECLARED_NOT_PROVEN` en fixtures **no** satisface exactitud. El test comprueba presencia/forma/ausencia y orden; no valida íntegramente CurrencyConfig/PaymentDefinition ni demuestra instrumentación inexistente.

Declaración: notas string incluso vacías; cashCountedByCurrency por moneda existente con importes finitos no negativos; denominationBreakdown, si presente, tiene conteos enteros no negativos y su suma coincide con lo declarado por esa moneda. Declaraciones por método con identidad única coinciden con métodos de contexto; ausencia solo cuando la modalidad no exige declarar. requireCashFundOnZ boolean y fondo/retiro/dejar efectivos son cantidades explícitas; reglas de presencia/resolución se guardan en contexto. Reconciliar leaving/withdrawal con la regla vigente, no inventar desde configuración nueva. Separar expected/system totals de entrada declarada. Identidad del operador coincide con contexto.

Z: report.id/closeEventId/manifiesto/control y nextOpenSetId provienen del resultado correspondiente; número pertenece a la reserva/serie correcta; conteos por miembros y totales/anexos corresponden al mismo corte/version. previousClose explícito o PROVEN_FIRST requiere evidencia; la variante ejecutable de J4 prueba EXPLICIT_PREVIOUS, no autoriza inventar el primero. Campos de impresión: anexos persistidos, hashes/versiones de renderer/assets/layout, información pública de empresa/receipt, opciones y locale; sección faltante no se recrea con datos vigentes. No imprimir/email/emitir al importar.

**Qué queda completo y qué no:** este documento fija las condiciones semánticas/rechazos por familia y variantes admitidas. La matriz `semantic-rules.json` distingue reglas ejecutables de las que requieren evidencia nativa/ERP. No se presenta un validador runtime completo ni se promueve `SEMANTIC_FIXTURE_VALID_NOT_AUTHORIZED` a recuperación exacta. Regla cuya prueba falta bloquea la capacidad correspondiente; no se da por cumplida porque el JSON es válido. Esa frontera es parte del contrato, no una omisión que el implementador pueda resolver suponiendo defaults.

## 4. Registro confiable, archivo y retención: respuesta POS

Aceptamos provisionalmente el registro lógico ERP de J3: identidades y revisión, ámbito canónico, coordenadas/antecedentes, digests por artifact y contenedor, aceptación técnica distinta de aplicación, retención y localizador administrado. La solicitud solo identifica registro/cierre; no aporta raíz de confianza. El catálogo ERP independiente debe fijar la raíz esperada y registryRevision; el archivo completo se recompone/verifica contra él, incluyendo previousClose/miembros/heads/sello. Un tombstone reconoce identidad sin tener que permitir restaurar.

POS acepta los errores AUTH_REQUIRED,ROOT_SCOPE,UNKNOWN_ROOT,ROOT_NOT_ACCEPTED,ROOT_REVISION_CHANGED,ARCHIVE_UNAVAILABLE,ARCHIVE_CORRUPT,ROOT_BINDING,ANCHOR_DOMAIN,ANCHOR_MODE y ROOT_UNAVAILABLE como errores lógicos candidatos. No les asignamos rutas ni códigos HTTP desplegados. Ante raíz inaccesible/cambio de revisión: repetir lectura consistente; nunca fallback al digest del ZIP. Ante archive corrupto/incompleto: conservar diagnóstico y bloquear exactitud, no recrear negocio.

El resultado técnico ACCEPTED con aplicación comercial FAILED puede ser raíz de contenido, pero FAILED permanece visible y no habilita reaplicar desde POS. SAME_EPOCH_SUFFIX exige prueba de continuidad de base/contador distinta de comparar UUID; NEW_EPOCH no prueba ausencia de cola antigua. La tabla/registros de fixtures son hipótesis de confianza, no autenticación.

Ratificamos propuesta conservadora sin GC automático de identidades/comandos/aceptaciones/sellos hasta política acordada. Deduplicación consulta activo+archivo+tombstone coherentemente antes de crear. TTL snapshot24h/recibo7d continúa propuesta sin SLA, no aplica a identidad de negocio. Si negocio exige borrar las claves de deduplicación, debe existir antes un corte de protocolo que rechace irrevocablemente esas épocas/IDs; sin esa garantía no se acepta el borrado. UUID nuevo no permite reemitir original antiguo.

**ERP debe decidir/probar:** almacenamiento y consulta autenticada reales del registro, atomicidad de aceptación/archivo, consistencia de registryRevision, índices por closeId/closeEventId/commandId y prueba de recuperación ante caída. **Operación+ERP:** plazos por clase, custodio/costo/volumen, copias/replicación, RPO/RTO, acceso/disponibilidad y bajas tenant/terminal. **POS:** cliente de consulta/importación y pruebas de continuidad/commit por backend, después del acuerdo; no implementados en J4. No se fijan obligaciones legales por inferencia.

## Estado de los ocho acuerdos

| Acuerdo | Estado POS J4 | Respuesta pendiente |
|---|---|---|
| 1. Intención/IDs/perfiles | Hallazgos binding corregidos; v2/control/series y condiciones semánticas propuestos explícitamente | ERP ratificar variantes/campos/roles; pruebas nativas para reglas no demostradas |
| 2. Control/retención | Control fuera de prefijo; política conservadora ERP aceptada provisionalmente | ERP/operación SLA/custodia/corte irrevocable si purga |
| 3. acceptanceDigest | J2 intacto, lookup idempotente tras auth y antes de CAS nuevo | ERP mecanismos atómicos/índices/crash |
| 4. proposedThrough/sealedThrough | R4 intacto; futura versión discriminada pendiente | Acuerdo ERP+POS de migración, no inferencia por campos |
| 5. Unicode/JCS | Correcciones ERP preservadas; sin hashes históricos nuevos | Parser raw/corpus completo antes de implementación |
| 6. Captura/orden/configuración | Reglas y estados de ausencia explicitados; cálculo intacto | POS perfiles/canales/evidencia de cobertura nativa y renderer |
| 7. Root/archivo | Registro ERP aceptado provisionalmente; domain/modo corregidos POS | Fuente durable independiente y continuidad real, no fixtures |
| 8. Canales/CAS/reservas | Sin evidencia nueva ni autorización | ERP Collection/Advance/wallet, guard común, cuarentena completa y asignación exclusiva |

## Ejecutar y límites

Desde raíz de ZIP/checkout:

```
node docs/pos-recovery-j3/verify-contract.mjs
python3 docs/pos-recovery-j3/verify-bytes.py
node docs/pos-recovery-j4/verify-semantics.mjs
node docs/pos-recovery-j4/verify-negatives.mjs
python3 docs/pos-recovery-j4/verify-bytes.py
```

Los negativos recalculan el hash del artifact y de la intención; además incluyen positivos de fecha bisiesta y antecedentes numerados. Las tres identidades closeControl cambian intentHash cuando cambia su valor. Los bytes publicados J1/J2/J3 se mantienen y se verifican por SHA256; los positivos v2 están en archivo nuevo. El ZIP incluye entrada ERP íntegra para ejecutar exactamente sus pruebas antiguas.

No se ejecutan journal/DB/aplicación/dispositivos ni se crean ventas/cierres. Todas las capacidades exactas permanecen bloqueadas por evidencia pendiente, aun cuando los fixtures nuevos pasan.
