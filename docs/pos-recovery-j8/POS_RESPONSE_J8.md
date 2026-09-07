# POS J8 — evidencia adicional B02–B06

Entrada ERP `f0fb5907`, PR #2009; leídos response-j7.md y delta B09/B11 de blockers-j6.md. Fuente POS fijada en `b53d11a` (SHA completo en source-bundle.json), TypeScript versión registrada allí. Solo documentos y pruebas offline sobre módulos puros capturados; no se carga App, DB, API, impresora, proveedor ni persistencia. **Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.**

SHA256SUMS ERP y procedimiento documentado pasan: extracción nueva del POS J7 incluido, checksums y verify-evidence.py con sus verificadores anidados. erp-results.json conserva salida. **B09/B11 cubren la observación documental**: ámbito/versión/corte/orden/cursor, concurrencia/expiración, estados refrescados, staging separado y reanudación/publicación. No identifico otra omisión concreta sobre esa observación. Snapshot, staging y publicación atómica no se declaran implementados ni demostrados.

## Artefactos y reproducción por ID

source-bundle.json contiene cuerpos completos TS y compilación CommonJS de ocho módulos puros, cuerpos completos de helpers de anexos/impuestos y renderer como evidencia estática, y fragmentos exactos del productor Dashboard, selección/pending helpers y objeto Z de App. capture-source.cjs genera la captura sin ejecutar esos archivos. verify-native.cjs ejecuta solo módulos permitidos y dos fragmentos de selección en VM sin acceso a red/DB; imports fuera de lista fallan. El reloj sintético fijo se usa solo para observar defaults. native-results.json conserva los pares completos de los objetos ensayados, diferencias por campo y resultados; no son documentos de cliente ni ventas emitidas.

| ID | Artefacto / versión / procedimiento | Resultado adicional | Faltantes y responsable |
|---|---|---|---|
| B02 | source-bundle.modules sourceIdentity/erpOutboundPayloads/customerIdentityContract; native-results.pairs; `pos.native-evidence.j8`, commit b53d11a; verify-native.cjs | Cinco originales sintéticos completos → normalizador común → constructor venta, y un original REFUND → constructor NC. Deltas recursivos con presencia antes/después; precedencias y cuerpos completos incluidos | **PENDING.** POS: cobertura completa de productores/canales, batch y envoltura HTTP final, extensiones/timestamps/schemas. ERP: receptor y almacenamiento del original, no derivado comercial |
| B03 | source-bundle.modules paymentSettlement/creditRules/zReportPaymentSummary; native-results.precision y pares; mismo commit/procedimiento | Aliases incompatibles, null/cero/invalid, fronteras +/−, acumulación por paso, signo REFUND, VOID y descarte reproducidos contra código capturado | **PENDING.** POS: reglas exhaustivas por campo/moneda/unidad y oráculo completo. ERP: contraste independiente de cada política y etapa, no solo preservación |
| B04 | cuerpos completos creditRules/paymentSettlement/zReportPaymentSummary; fragments.dashboardProducer/resolvers y staticSources de anexos; native-results.resolver | Ambigüedad y orden de métodos reproducidos; productores filtered*, declaración y denominaciones incluidos completos en captura del tramo Dashboard | **PENDING.** POS: grafo transitivo instrumentado de todas las lecturas, 14 bloques efectivos/versiones/hashes/resolvers. ERP: contraste de cobertura y conservación histórica; no snapshot auténtico aportado |
| B05 | fragments.dashboardProducer/declaration/confirm/closePreparation/zObject; mismo commit; contraste estático con --source | Separación por campo de entradas, derivados y defaults descrita abajo. Apertura actual sigue derivada; no hay evidencia nueva de apertura real | **PENDING.** POS: tipo completo y confirmación/instante/identidad/política preservados; operación política; ERP conservación. Captura durable nueva requeriría fase autorizada, no se implementa |
| B06 | fragments.pending/selection/zObject; módulos analytics/orderServiceType; staticSources closeReportOptions/closeReceiptSummary; native-results.selection | IDs faltantes no exigen rechazo en fragmento, duplicados por ID/revisión no se colapsan, empate conserva orden de entrada, cash/collections conservan orden local. Frontera temporal pending reproducida. Objeto Z completo en fuente, anexos en cuerpos completos | **PENDING.** POS: salida Z/anexos integrada completa y oráculo nativo sin efectos; comparación de relaciones/orden. ERP: contraste de selección/revisiones/relaciones y recepción. No se emitió un Z de prueba |

Todos los resultados significan caracterización limitada; ninguno cierra B02–B06. La compilación se obtuvo de TS capturado; en checkout se puede regenerar y comparar source/compiled con capture-source.cjs usando la versión TS registrada. --source contrasta textos/hashes con git. Desde ZIP solo se comprueba consistencia interna y ejecución del código capturado, no autenticidad independiente.

## B02 — transformaciones y alcance real de los pares

Normalizador común: source_transaction_id precede id; source_terminal_id precede terminalId; IDs de pago pueden derivarse como `${sourceTransactionId}-payment`; timestamp ausente toma now. Estos fallbacks se observan, no se adoptan para recuperación. Payment se reconstruye con lista de campos; privateExtra/gatewayRaw sintéticos desaparecen. El constructor ERP añade coerce de items (incluye parse de string), normalización, saneamiento de líneas y tarifas, campos comerciales/moneda/cliente y filtro fiscal. Los cuerpos completos muestran también ramas no ejercitadas; no equivalen a cobertura de todas las entradas.

En los pares ensayados desaparecen images, attributes y tariffId inválido de la línea. Se conservan id de producto y cartId de línea por separado. metadata de gateway reconocida se normaliza; extensiones fuera de la lista no sobreviven. Para fiscalMode NONE, ncf/ncfType no aparecen en JSON y fiscalProvider pasa NONE. Refund/NC usa el mismo constructor; no se valida con ello reembolso comercial.

**Estos pares representan etapas de transformación, no canales completos.** No llamar al normalizador «batch»: faltan envolturas/serializadores y decisiones de encaminamiento del emisor real, payload final serializado y receptor. No se ejecuta ApiSyncAdapter ni transactionService porque incluyen IO/persistencia. Collection/Advance, wallet independiente, Cash/Fiscal y sus canales completos siguen por aportar. No se asume exclusión de ninguno. El original previo debe preservarse: no reconstruirlo desde la lista reducida del pago o documento comercial.

## B03 — reglas observadas por campo, sin corregirlas

| Campo/ruta | Precedencia/coerción observada | Caso comprobado |
|---|---|---|
| Aplicado local getPaymentAppliedBaseAmount | appliedAmount ?? applied_amount ?? amountApplied; si no null/undefined, Number y no finito→0; roundToTwo. Sin preferido, amount | 70/60/50 →70 |
| Aplicado normalizado | applied_amount ?? appliedAmount ?? amountApplied; Number, solo finito conserva valor; luego todos los aliases se escriben iguales | Mismo original →60 después de normalizar |
| Aplicado inválido | Local preferido 'bad'→0. Normalizador lo deja undefined; cálculo posterior cae a amount | amount100, aliases 'bad': 0 local vs100 normalizado |
| Aplicado null/cero | ?? salta null, no salta cero | aliases null/null/0 →0 antes/después; preferido null sin otros →amount99 |
| Cambio normalizado | change_amount ?? changeAmount; moneda change_currency_code antes de changeCurrencyCode | Par de aliases incluye 40 vs30 y muestra salida completa; no reescribir original |
| roundToTwo | Math.round((value+EPSILON)*100)/100 | 0.004→0; 0.005→0.01; 1.005→1.01; −0.005→−0; −1.005→−1. JSON serializa −0 como0; resultado incluye negativeZeroBoundary=true |
| Resumen por método | roundMoney tras cada suma de bucket; filtra abs(amount)>0.0001 | [0.004,0.004]→[]; [0.008]→0.01. No equivalencia por suma final |
| Signo/descarte documental | REFUND o B04 usa −abs; documentType VOID se omite en este helper | REFUND100→−100; VOID→[] |

La primera ejecución del ensayo distinguió −0 de0 mediante assert estricto; se registró explícitamente el signo antes de JSON, sin cambiar código nativo. Los esperados de aliases, fronteras, signo y selección son assertions explícitos, además de la comparación con resultados registrados. No se modifica un verificador contractual para permitir estas discrepancias ni se infiere corrección monetaria de estos valores.

## B04 — dependencias adicionales localizadas

Cadena: buildZReportPaymentMethodSummary → resolveConfiguredMethod/resolveZReportPaymentMethodName → resolvePaymentMethodTypeForRuntime y paymentEntryIsCxCCredit → creditRules; aplicado → paymentSettlement. Resolver de métodos lee paymentMethods, orden, id/name/type/isEnabled, method/methodId/methodLabel; marcadores CREDIT/PENDING/PENDIENTE pueden cambiar clasificación. Con IDs `x`/`X`, el primer match en el array determina FIRST o SECOND al invertir configuración. Capturar solo un mapa por ID perdería ese orden/ambigüedad.

Dashboard: activeTerminal usa match por id o primer terminal; flags forceDenominationCount/blindClose, baseCurrency/monedas, zReportDeclaredPaymentMethodIds, amounts strings y denominationCounts alimentan los productores. getDenominationsForCurrency usa tabla por moneda y fallback; buildDenominationBreakdown convierte Number, inválidos→0 y descarta quantity<=0. declaredAmountOrExpected usa expected line.amount para métodos no seleccionados; para seleccionados usa Number(input||0). filtered* y replacementTransactions dependen de arrays locales e IDs/terminal/zReportId.

Anexos: el objeto Z referencia buildCloseTaxSummary, buildServiceTypeReport y reportDetails; se incluyen cuerpos completos de helpers, pero **no se instrumentaron todas sus dependencias transitivas ni lecturas**. No se acredita configuración histórica efectiva con este código/configuración sintética. Persistencia de 14 nombres de bloque o VALUE arbitrario sigue insuficiente.

## B05 — confirmación, derivados y defaults

- Entradas UI: cashCountedByCurrency, denominationCounts, declaredPaymentMethods, notes. Enviar estos valores al callback no demuestra confirmación durable por operador ni instante/versiones.
- Derivados: efectivo esperado, discrepancias, cashIn/out, estadísticas, sumas por método, cashToWithdraw y líneas denominationBreakdown. Declaración por denominaciones es suma de cantidades ingresadas; salida se filtra a positivas.
- Defaults: efectivo parseFloat inválido/ausente→0 en modo simple; métodos no seleccionados toman esperado, no conteo explícito. App usa Number/no finito→0, arrays/mapas vacíos y usuario sys/System cuando falta; los defaults por campo completos están en zObject/closePreparation.
- Apertura: mínimo de transacciones/movimientos disponibles o now; no incluye collections en openedAtCandidates. **No es evidencia real de apertura**. No se crea session_id ni se corrige cálculo. B05 sigue bloqueado hasta evidencia preservada, y mecanismos durables faltantes requieren fase autorizada.

## B06 — selección, revisiones y salida

IDs explícitos se convierten a Set; la selección itera arrays locales, no el orden solicitado. En el ensayo solicitado A/B/MISSING se obtienen B/A con fecha igual y MISSING ausente, sin rechazo en ese fragmento. Esto no prueba que ninguna otra capa advierta; sí demuestra que ese bloque no impone igualdad de conjuntos. Dos filas A con revisiones1/2 permanecen ambas: no existe selección de revisión exacta en ese fragmento. La recuperación deberá exigirla fuera de esta lógica actual; no se implementa.

Transacciones ordenan solo por fecha; fecha igual conserva entrada en el motor Node ensayado, sin desempate documental explícito. Cash M2/M1 y collections C2/C1 conservan arrays locales, aunque los IDs solicitados sean inversos. La ruta sin IDs usa pending helpers: último cierre menos cinco minutos con comparación estricta; en cierre00:10, fecha00:05 queda fuera y00:05:00.001 entra. No es prueba de sesión exacta. Ambas rutas están capturadas; el ensayo no cubre toda topología/alias de terminal ni autenticación.

Replacement mezcla historial con activos dando prioridad por ID a activo, y permite membresía del cierre reemplazado; se incluye como fuente estática, **no como camino de recuperación admitido**. Repetición/reemplazo con efectos permanece fuera del alcance demostrado y no puede usarse para reabrir ventas. La decisión de canales/variantes corresponde al usuario; si aparece una dependencia no cubierta, bloquear jornada íntegra.

La fuente completa `zObject` enumera salida Z: identidad/serie, apertura/cierre/usuario, baseCurrency, resumen/declaraciones por método, efectivo por moneda, dos aliases de denominaciones, cashSales/in/out y detalles, fondo/retiro, conteo/notas, declared_totals, system_totals, sync_audit, stats, serviceTypeSummary/Transactions, closeTaxSummary, enabledSections, reportDetails, syncStatus y rama replacement. Esto aporta **la definición completa de construcción**, no una salida integrada completa validada. No se simulan anexos vacíos para afirmar equivalencia. Siguen pendientes ejecutar el oráculo íntegro aislado con configuración/declaración completas y contrastar salida Z/anexos; persistencia/impresión no se ejecutan.

## Límites y ejecución

ERP conserva recepción, CAS, autoridad de series, raíz/archivo y mecanismos de retención; operación custodia/plazos/disponibilidad. Canales/métodos, fiscalidad y reimpresión exacta siguen pendientes del usuario; no hay exclusiones por defecto ni filtrado de filas para PASS. Una dependencia incompatible/desconocida bloquea la jornada completa. Ninguna prueba sintética demuestra cola perdida, continuidad durable, autenticidad remota o archivo.

Se conservan v2/closeControl, IDs estables, efectos solo al futuro commit, una serie por comando y multiserie bloqueada. reservationId=null no prueba exclusividad. Pairing/takeover existente se reutiliza; no se toca.

Desde ZIP extraído (Node y Python con jsonschema 4.25.1):

```sh
shasum -a 256 -c SHA256SUMS
python3 docs/pos-recovery-j8/verify-review.py inputs/pos-recovery-erp-j7-f0fb5907.zip
node docs/pos-recovery-j8/verify-native.cjs
```

En checkout con git, añadir --source al runner. Para regenerar TS/compilado: NODE_PATH apuntando a TypeScript, `node docs/pos-recovery-j8/capture-source.cjs`; comparar con source-bundle.json (sourceCommit debe referir la base auditada). Verificar el ZIP no necesita TypeScript: ejecuta compilado capturado y verifica resultados. No ejecutar --record durante verificación; solo se usó para registrar esta entrega después de assertions explícitos. Tests de app/build no se ejecutan: solo docs/offline. Antecedentes fijados en historical-sha256.json.

**Todos B02–B06 siguen PENDING. Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED. No certifica recuperabilidad ni autoriza implementación.**
