# POS J7 — evidencia P0 por bloqueante ERP J6

Entrada ERP `64cabf53`, PR CLIC-ERP #2008. Leídos primero response-j6.md y blockers-j6.md. Base POS `4791868` (merge J6). Solo revisión documental y pruebas offline; sin implementación, producción, dispositivo ni ventas/cierres de prueba. **Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED.**

SHA256SUMS y verify-j6.py pasan, incluido el runner anidado. Sin discrepancia reproducible en esas pruebas. Los tres hallazgos siguen cerrados solo en su subperfil documental. No se alteran verificadores semánticos, binding ni vectores históricos. No se repiten los ocho acuerdos.

## Observación concreta sobre la matriz

**B09, con referencia a B11: falta un criterio explícito de snapshot/paginación estable en la lista consolidada.** B09 exige raíz estable y archivo íntegro; B11 exige importación idempotente. Ninguna de esas condiciones, por sí sola, exige que todas las páginas pertenezcan al mismo corte cuando llegan nuevas operaciones o cambian estados ERP durante la descarga. Es una omisión de trazabilidad en la matriz, no un contraejemplo del verificador ni afirmación de ausencia en los contratos anteriores.

Texto propuesto para añadir a B09: «Snapshot identificado/versionado, con alcance/corte y orden de paginación inmutables, conteos/totales/digests ligados a ese corte. Cursor ligado al snapshot y al ámbito autenticado. Mutaciones posteriores no alteran páginas ya emitidas ni cambian la revisión seleccionada; si no puede conservarse el corte o expira, rechazo explícito y reinicio seguro, nunca mezcla de snapshots. Estados de recepción/aplicación deben indicar su versión/corte; cualquier refresco posterior se separa del contenido restaurado».

Criterio de aceptación: mismo resultado completo al descargar de una vez o por páginas repetidas/interrumpidas; inserciones, revisiones y cambios de estado concurrentes no causan omisiones/duplicados/mezcla; expiración y cursor de otro snapshot/terminal/empresa se rechazan. ERP aporta snapshot/cursor y consistencia; POS aislamiento de staging/reanudación/importación; operación plazo de disponibilidad. **Pendiente de diseño/evidencia; no implementado ni acreditado aquí.** No se crea otro ID ni se renumera la matriz.

No identifico otra contradicción concreta que requiera modificar la matriz. B05 exige evidencia durable de apertura: el openedAt derivado actual, registrado abajo, no satisface ese criterio. No se propone session_id ni reconstrucción alternativa; si falta evidencia, permanece pendiente.

## Entregas POS P0

El índice machine-readable es evidence-index.json, versión `pos.p0.evidence-index.j7.v1`. Cada fila fija ID, artefactos, commit, procedimiento, resultado y evidencia faltante. source-excerpts.json contiene extractos exactos con números de línea y SHA256 del archivo completo, del commit `4791868`. Son observaciones estáticas; **ningún B02–B06 queda aceptado**. Las referencias J3/J6 y los vectores J2 conservan su versión histórica, no se presentan como nuevas pruebas nativas.

| Bloqueante / artefacto | Evidencia concreta aportada | Resultado / evidencia que falta |
|---|---|---|
| **B02 / P0-1** source-excerpts.json (sourceIdentity, erpOutboundPayloads); inventario native-closure J6 y capture-profiles J3 | El normalizador reconstruye payments con lista explícita, conserva algunos campos gateway y transforma timestamp; payload de venta pasa normalización antes de enviarse. Inventario: 156 declaraciones alcanzables y 16 abiertas, no schemas cerrados | **Parcial estático.** Faltan schemas completos y extensiones clasificadas, pares de cada productor/canal local→directo→batch→receptor, ausente/null/unknown y preservación ERP. La lista del normalizador no demuestra conservación de todos los originales |
| **B03 / P0-2** source-excerpts.json (paymentSettlement, zReportPaymentSummary) | Aplicado base prefiere appliedAmount/applied_amount/amountApplied y redondea a dos decimales; fallback a amount. Resumen redondea acumulación por bucket; signos refund y exclusión VOID son observables en fuente | **Parcial estático.** Faltan tabla por campo/moneda/unidad, precisión/escala/modo/etapa normativa y oráculo aislado con fronteras/acumulación. No se ejecutó fórmula ni se convirtió roundToTwo/roundMoney en norma universal. 1e-8 sigue solo fixture |
| **B04 / P0-3** source-excerpts.json (resolver de métodos y productor reportData); capture-profiles J3 | El nombre/ID de método puede depender de config.paymentMethods, isEnabled y fallbacks. La UI entrega configuración de terminal y valores calculados a handleZReport | **Parcial estático.** Faltan mapa transitivo e instrumentación de lecturas, tipos/valores efectivos de 14 bloques y versiones/hashes/resolvers; reloj/locale/orden. Estos extractos no acreditan readCoverage ni eliminan defaults actuales |
| **B05 / P0-4** source-excerpts.json (ZReportDashboard y handleZReport) | UI entrega cashCountedByCurrency, expectedCashByCurrency, fondo/retiro, declaraciones por método y denominationBreakdown; handleZReport recibe reportData:any y calcula openedAt de fechas transacciones/movimientos o now | **Parcial estático, apertura durable pendiente.** Faltan tipo completo/política histórica y confirmación preservada del operador, evidencia de apertura real y persistencia por backend/ERP. No se usa mínimo/now para acreditar B05 |
| **B06 / P0-5** source-excerpts.json (selección handleZReport, analytics, resumen); lineage-vectors J2 | Rutas de selección/estadística y orden de iteración están localizadas. UI entrega transactionIds/cashMovementIds/collectionIds. Los vectores J2 modelan dependencias de documentos cerrados | **Parcial estático + modelo sintético histórico.** Faltan oráculo nativo completo, Z/anexos y comparación de importes/IDs/relaciones/orden, medianoche y dependencia histórica. Vectores no prueban ejecución nativa, ni captura/recepción completa |

Procedimiento común por fila: `verify-evidence.py` comprueba índice, integridad de antecedentes y resultado ERP. Con `--source`, compara cada extracto y hash contra el commit fijado en git, sin importar módulos POS. Omitir `--source` desde ZIP: comprueba consistencia interna, no procedencia independiente. erp-results.json registra comando/salida ERP; pos-results.txt registra comprobación local con fuente. El éxito del procedimiento significa **evidencia estática reproducida**, no aceptación del bloqueante.

Versiones: fuente operativa fijada por SHA completo en source-excerpts.json; inventario de tipos J6 procede de dfb2b13 y es idéntico a J3; perfiles propuestos J3, intención v2/perfiles .j4 y reglas J5 permanecen separados. Para B02 la matriz de canales completa sigue por aportar; no se infiere equivalencia entre canal directo, batch, reenvío y almacenamiento ERP a partir de sus nombres.

## Orden de trabajo pendiente, sin construir mecanismos

1. B02: completar clasificación por canal y resolver campos abiertos. Relacionar Collection/Advance con B16, wallet con B17, Refund/Cash/Fiscal con B20; no eliminar esos canales por no estar en fixtures.
2. B03–B04: fijar reglas de precisión por campo y mapa completo de dependencias antes de redactar un oráculo de equivalencia. La instrumentación/oráculo offline siguen por aportar; no requieren implantar journal, pero no están incluidos en esta entrega.
3. B05: separar valores que el operador confirma, valores derivados y evidencia real de apertura. No puede acreditarse captura durable inexistente con un tipo TS o fixture. Diseñar su contrato será tarea separada; demostrar persistencia requerirá mecanismos y fase autorizada.
4. B06: preparar comparación nativa aislada con entradas completas una vez resueltos perfiles/configuración/declaración. No llamar equivalencia a la igualdad de ocho fixtures mínimos. B15 impresión exacta depende de decisión del usuario, sin elección por defecto.

B01 requiere detector/política de elegibilidad y evidencia de toda la jornada/dependencias; ninguno está demostrado por el índice. B09–B14 requieren mecanismos durables y pruebas de fase autorizada: quedan pendientes, no se implementan. El inventario estático no acredita recepción, CAS común, autoridad de series, registro confiable, archivo, tombstones o retención.

## Alcance y responsabilidades conservados

DOP/tasa1, sin impuestos/descuentos/crédito, NONE histórico comprobable y máximo una serie **por comando** siguen candidato. SALE con TICKET y CLOSE_SET con Z_REPORT pueden pertenecer a la misma jornada; no se exige contador único compartido. Una operación que necesita dos series sigue bloqueada, sin división artificial.

Las decisiones de usuario sobre reimpresión exacta, canales/métodos y exposición fiscal siguen abiertas. No se presupone ninguna exclusión. Si cualquier miembro o dependencia queda fuera o es desconocido, se bloquea **la jornada completa**, sin filtrar filas para obtener PASS. La ausencia en ZIP no prueba ausencia en dispositivo; NONE no se deduce de plan vacío. Sin impuestos no significa sin fiscalidad; sin crédito nuevo no excluye abonos históricos.

Se conservan intención v2/closeControl, IDs congelados antes del hash y estables en reintentos; efectos/resultados solo al futuro commit, sin traducción silenciosa de v1. reservationId=null declara INTERNAL_EXCLUSIVE y no prueba exclusividad. No se modifica expectedSeries ni los modelos publicados.

ERP conserva la responsabilidad de B09/B12/B13 y mecanismos B14, receptores B16/B17, cuarentena fiscal B18 y reasignación B19. POS aporta perfiles y evidencia nativa, y después prueba local por backend con autorización. Operación decide custodia/plazos/disponibilidad/copias/retención y resolución, sin que esa decisión demuestre mecanismos. ACCEPTED técnico y FAILED comercial permanecen separados; no reaplicar. Ni raíz sintética ni anclaje ni conteos acreditan continuidad durable o cola perdida. Legacy permanece UNKNOWN.

## Reproducción

Node y Python con jsonschema 4.25.1, sin red/DB/runtime/dispositivo:

```sh
shasum -a 256 -c SHA256SUMS
python3 docs/pos-recovery-j7/verify-evidence.py inputs/pos-recovery-erp-j6-64cabf53.zip
```

En checkout POS con el commit fijado disponible, añadir `--source`. El runner verifica input SHA, SHA256SUMS ERP y ejecuta verify-j6.py en extracción temporal; luego comprueba índice y antecedentes. No reescribe resultados ni hashes. ZIP ERP se incluye únicamente en el artefacto de intercambio; no se añade otro binario al repo. git diff --check y pruebas offline aplican a estos cambios documentales; no se ejecutan build ni tests operativos.

**Ningún bloqueante se marca cerrado por esta entrega. Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED. No autoriza implementación ni certifica recuperabilidad.**
