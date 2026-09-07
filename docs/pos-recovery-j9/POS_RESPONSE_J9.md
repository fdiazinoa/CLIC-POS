# POS J9 — transporte aislado y composición nativa sin efectos

Entrada ERP `6bea9ad3`, PR #2010, leído primero response-j8.md. SHA256SUMS y procedimiento documentado pasan, incluido contraste ERP independiente. Fuente POS `0d86814` (SHA completo y TypeScript en source.json). Versión de evidencia `pos.evidence.j9.v1`. **Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED.**

Solo documentación/pruebas offline. No se ejecutan componentes UI, servicios de persistencia, red, proveedor, impresora, journal ni asignación de números. No se cambia código operativo ni vectores históricos. El objeto Z se calcula únicamente en memoria con IDs/número/contexto sintéticos suministrados; no se emite ni guarda cierre de prueba.

## Entrega por bloqueante

| ID | Artefacto / procedimiento | Resultado nuevo | Faltante restante |
|---|---|---|---|
| B02 | source.json: tres métodos reales de ApiSyncAdapter y transformadores; results.json.transport; verify-native.cjs | Cuerpos UTF-8 finales, longitud y SHA de POST directo `/transactions` y maestro local `/api/sync/transactions`, capturados por sustituto inerte de fetchWithRetry. Original etiquetado conserva Date, undefined, −0, aliases y extensión antes de normalizar | Productores completos, schemas por productor/canal, batch, retry401, resolución/autenticación real y reenvío posterior no cubiertos. ERP aporta receptor, mapeo, persistencia/lectura íntegra. **PENDING** |
| B03 | field-rules.json; results.json.integrated original/normalized; helpers nativos y objeto Z exacto | Contraste compuesto: resumen pago110 original vs100 normalizado, mientras venta/anexo vendedor100 en ambos. No se normalizan esperados para hacerlos coincidir | Tabla exhaustiva por productor/campo/moneda/unidad y resto de ramas. Reglas observadas no política universal. ERP contrasta composición/etapas. **PENDING** |
| B04 | results.json.integrated[].reads y input; source.json módulos transitivos cargados | Proxy registra get/presencia/tipo y enumeración de claves de config/operador/operaciones/declaración en ejecución de composición. Resultado instrumentado coincide íntegramente con ejecución sin proxy | Traza solo ramas ensayadas, no cobertura universal ni 14 bloques históricos auténticos. Orden y ausencias quedan registrados; falta configuración histórica preservada con autoridad/versiones/resolvers. **PENDING** |
| B05 | Matriz siguiente; source.json.uiGate/inputUi/uiDom; results.json.uiCases | Guard de confirmación real aislado caracteriza campos requeridos, no vacíos/finito/fondo; restricciones DOM/Android revisadas. Sin atribuir confirmación durable | Identidad/instante/política/apertura real y almacenamiento no existentes como evidencia. No se inventan; fase autorizada si requieren mecanismo nuevo. **PENDING** |
| B06 | source.json.integrated y helpers; results.json.integrated[].report completo | Selección→estadísticas/resumen→anexos→objeto Z completo en memoria, sin persistencia ni series. Anexos vendedor/artículo/horas no vacíos, se comparan totales y relaciones; medianoche, ID faltante y empate/revisiones duplicadas compuestos | Más ramas/configuraciones y contraste ERP independiente de salida. Terminal/auth/continuidad/atomicidad no probados. Replacement/impresión no ejecutados. **PENDING** |

Procedimiento común: verify-review.py ejecuta procedimiento ERP y verify-native.cjs, verifica antecedentes y puede comparar fuentes contra git con --source. results.json guarda originales/entradas, bytes y salida íntegra. verification-results.txt conserva ejecución. Ninguna fila se marca aceptada como recuperación.

## B02 — qué se ejecutó y qué se sustituyó

Se capturaron por AST los cuerpos completos de buildOperationalPostBody, postErpSalesTransactionWithSmartAuth y postLocalSalesTransactionWithSmartAuth, sin cargar ApiSyncAdapter ni sus imports. Se ejecutan los métodos contra objetos de frontera inertes: autenticación/target/credenciales ficticios, log vacío y fetchWithRetry que solo guarda argumentos en memoria y devuelve respuesta sintética200. Se prueba la rama inicial, no retry401.

Los bytes son exactamente el `body` que esos métodos construyen con JSON.stringify, **no un HTTP real ni canal completo**. Headers/auth se sustituyen; no se afirma transporte de credenciales, resolución ni servidor. En el directo, buildOperationalPostBody reemplaza source_terminal_id por ERP-T1 y conserva referencia local cuando corresponde; en local permanece T1 e incluye erp_base_url. Las URLs `.invalid` son sintéticas y nunca se consultan.

El original es Transaction-shaped sintético; no se invoca un productor de venta con efectos. Se guarda una representación diagnóstica etiquetada por propiedad enumerable: undefined, Date con ISO, número con −0, null, arrays, objetos y valores primitivos. Esto distingue presencia y tipo para estos originales ordinarios; **no es codec operacional propuesto ni cubre ciclos/prototipos/símbolos**. La representación previa coincide antes/después del ensayo. Aliases discrepantes, unknownGateway y extension permanecen en la evidencia original aunque la normalización pierda campos.

No se reconstruye original desde payload. Faltan definición/captura real por cada productor y canal (incluidos Collection/Advance, wallet, Cash/Fiscal y batch). La evidencia nueva completa el tramo de construcción del body para las dos ramas ejercitadas, no el trayecto productor→ERP. ERP debe aportar separadamente receptor→transformaciones→almacenamiento→lectura íntegra y estado recepción/aplicación; no suplirlo con documentos comerciales.

## B03 — composición y reglas

field-rules.json vincula regla a archivo/etapa y evidencia. No modifica precedencias. El caso original conserva appliedAmount70 y applied_amount60; al componer Z sobre original, resumen pago110 (40+70), mientras total comercial y anexo vendedor100 (40+60). Al componer sobre normalizado, resumen100. Ambos objetos completos quedan registrados: se evidencia la diferencia, no se considera equivalente ni se corrige la venta.

El resumen redondea por bucket; App suma líneas ya redondeadas. Anexos calculan desde totals/items por sus propias rutas y round2; el efectivo declarado/esperado se suma con Number por moneda sin conversión adicional en ese tramo. Solo DOP se ensaya, no se certifica suma multimoneda. Las fronteras/−0/descartes ya caracterizadas J8 no se repiten como negativos nuevos; se conserva su evidencia y se añade composición.

Los asserts independientes verifican importes comerciales de entrada y anexos, conteos/IDs y diferencia110/100 esperada. Además se compara toda salida con results.json. Ramas fiscales complejas, todas las unidades y variantes de precisión siguen pendientes; helpers completos no equivalen a cobertura de todas sus ramas.

## B04 — alcance de la instrumentación

La composición carga closeReportOptions→fiscalBreakdown→taxIdentity, resumen→paymentSettlement/creditRules, analytics, orderServiceType y closeReceiptSummary. Los proxys registran rutas de lectura, presencia propia/tipo y enumeración; config y declaración efectivas del ensayo quedan en input etiquetado. Se compara resultado con/sin proxy para detectar cambios introducidos por instrumentación.

Se preservan arrays y su orden; no se convierte paymentMethods a mapa. Ambigüedad de métodos sigue observada en J8; J9 añade trazas de composición, no prueba todas las permutaciones. La ausencia consultada se registra, no se convierte en dato históricamente conocido. La traza incluye lecturas de serialización de salida y no es un inventario mínimo de dependencias. No instrumenta internamente Date/localeCompare: se fija TZ America/Santo_Domingo y reloj sintético, y **locale/ICU y demás ramas siguen pendientes**. Configuración histórica real, versiones de política, 14 bloques y autoridad ERP no se acreditan por esta configuración sintética.

## B05 — matriz de origen/confirmación

| Campo/familia | Entrada / derivado / default | Restricción observada | Evidencia durable requerida |
|---|---|---|---|
| cashCountedByCurrency simple | String UI→parseFloat; omisión/inválido→0 al calcular | Guard exige no vacío y parseFloat>=0 para monedas requeridas. Input desktop number step0.01; Android text readonly y keypad separado | Valor original confirmado, moneda, operador e instante/política |
| denominationCounts | Entrada string→cantidad; suma cantidad×denominación; líneas positivas | Desktop min0 step1 y handler elimina no dígitos; Android también elimina no dígitos. Guard cuenta si alguna cantidad no vacía>=0 | Cantidades confirmadas, tabla histórica de denominaciones, modo vigente |
| declaredPaymentMethods | Seleccionados→Number(input||0); no seleccionados→expected | Guard seleccionados: no vacío y Number finito; no prueba conteo explícito de los no seleccionados. Input number step0.01/Android keypad | Selección histórica por método, entrada confirmada y diferencia frente a derivado |
| fondo/retiro | Configuración y efectivo derivado | Si fondo requerido>0, contado base debe cubrirlo | Política efectiva/versión y valores confirmados |
| expected*/stats/anexos | Derivados de operaciones y configuración | No son entrada física del operador | Entradas/orden/revisiones y versiones del cálculo |
| usuario/fecha | Contexto currentUser; defaults sys/System; closedAt reloj al construir | Callback/objeto no acredita firma ni confirmación durable | Identidad autenticada e instante preservado; prueba de atomicidad posterior |
| openedAt | Mínimo de movimientos/transacciones o now | Collections no forman parte del mínimo | Apertura real preservada. No existe evidencia nueva aquí; no se inventa session_id |

uiCases ejecuta el guard capturado con una función declarativa suministrada para la validación de efectivo (misma condición observada), no lifecycle/DOM. Vacío/−1 no pasan en ese contexto de efectivo;0,1.50,1e2 pasan. **No afirma que cada cadena pueda introducirse por todos los teclados**. Number/parseFloat y transformaciones del productor están documentados, no se usan cadenas arbitrarias como prueba de admisibilidad UI. Type/min/step por sí solos no prueban confirmación/persistencia. Falta ensayo UI offline completo si se necesita esa garantía; no se ejecuta dispositivo.

## B06 — salida integrada sin efectos

Se ejecutan fragmentos exactos de selección y preparación de App, luego resolución de secciones, buildCloseReportDetails, buildCloseTaxSummary y construcción completa newZReport. Se excluye expresamente el bloque que asigna/incrementa series y todo lo posterior al objeto. IDs/número sintéticos suministrados son contexto de laboratorio, **no asignaciones ni cierre emitido**. La declaración sintética completa es entrada, no callback UI confirmado.

Cuatro escenarios compuestos: original, normalizado, ID solicitado ausente y fecha empatada con dos revisiones A. Cada uno conserva requested/found/unresolvedIds y salida Z/anexos completa. El último reproduce tres filas y anexo140 por sumar ambas revisiones, sin presentar eso como restauración correcta. IDs faltantes no se filtran del diagnóstico. Todos tienen dos fechas, cash M2/M1 y collections C2/C1; allocations referencian CLOSED-SALE como dependencia y no insertan esa venta en cálculo. collectionsTotal15 se compara; pertenencia histórica auténtica no se prueba.

Resultados observados: primer/último ticket dependen del orden por fecha/entrada, cash conserva M2/M1, vendedor/artículo/horas se construyen con datos reales del escenario, apertura derivada23:58 se registra como diagnóstico, no sesión. Los reportes tienen todos los campos resultantes del constructor, incluyendo anexos generados, sin sustituirlos por vacíos manuales. El escenario fiscal cero puede producir tax arrays vacíos por el helper; no acredita variantes fiscales.

Una revisión duplicada, ID no encontrado, dependencia incompatible o configuración desconocida bloquea la jornada candidata completa. El oráculo caracteriza cálculo vigente, no es verificador de elegibilidad ni autoriza cierre. No reabre CLOSED-SALE ni aplica su collection a deuda. Replacement y reimpresión exacta siguen sin autorización/alcance decidido.

## Reproducción y límites

Node, Python con jsonschema4.25.1. Desde ZIP extraído:

```sh
shasum -a 256 -c SHA256SUMS
python3 docs/pos-recovery-j9/verify-review.py inputs/pos-recovery-erp-j8-6bea9ad3.zip
```

Prueba nueva directa: `TZ=America/Santo_Domingo node docs/pos-recovery-j9/verify-native.cjs`. En checkout añadir --source al runner; capture.cjs regenera fuente/compilado con TypeScript declarado, solo lectura. No usar --record en verificación. Los bytes históricos y verificadores contractuales permanecen intactos. No build/tests operativos: cambios solo documentales/offline, git diff --check.

ERP: recepción/CAS/autoridad de series/registro/archivo; operación: custodia/disponibilidad/retención. Decisiones de usuario: canales/métodos, fiscalidad y reimpresión. No se asumen exclusiones. Se conservan v2/closeControl, IDs estables, efectos solo al futuro commit, una serie por comando y null no prueba exclusividad. Pairing/takeover se reutiliza.

**B02–B06 siguen PENDING. Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED. No demuestra autenticidad remota, continuidad durable o recuperación de cola perdida, ni autoriza implementación.**
