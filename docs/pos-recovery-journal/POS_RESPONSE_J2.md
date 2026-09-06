# POS J2 — respuesta a revisión ERP de J1

Solo revisión documental y pruebas offline. Base POS `2e353b43456e04ad92aac8a0c9b1210dc33d18b9` (develop, incluye J1). Código operacional auditado permanece el de `2e200a2`; no se reaudita producción. Entrada: `pos-recovery-j1-erp-review.zip`, preservada íntegra en la entrega ZIP. ERP no declaró commit nuevo para esa revisión. **UNAGREED; legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED.**

## Problemas reproducidos y alcance de la corrección

Se verificaron SHA256SUMS del paquete recibido y se ejecutaron `verify-independent.py` y `verify-review.py` sin cambios. El primero reconstruye 13 preimágenes, 20 bytes/digests y cuatro vectores propios con un canonicalizador numérico limitado. El segundo pasa los verificadores originales y reproduce ambos huecos; su PASS significa reproducción, no corrección.

POS corrige `validateCalculationInput` en verify-vectors.mjs: exige claves transactions/cashMovements/collections, arrays, referencias de tres campos, tipo TRANSACTION/CASH_MOVEMENT/COLLECTION respectivamente, revisión exactamente seleccionada, exclusión de dependencias por identidad aunque cambie la revisión, una referencia por identidad y cobertura de todos los miembros calculables. No admite WALLET autónomo. Preserva el orden de cada array; compara sin ordenar la entrada. Los negativos de tipo/revisión/omisión/duplicado reconstruyen el grafo y hashes antes de validar: no dependen de detectar un hash viejo.

J2 añade el positivo con orden de cálculo [sale-B,sale-A] frente al manifiesto [sale-A,sale-B], y negativos independientes con razón esperada para referencia cerrada, tipo equivocado en cada array, revisión antigua, omisión y duplicado. Los hashes J1 originales se conservan: solo cambia el verificador.

El sorted() natural de R4 y su canonicalizador de objetos numéricos siguen siendo responsabilidad ERP. No se corrigen copias de ERP ni se recalculan sus hashes históricos aquí. Se incluyen los cuatro vectores propios ERP como evidencia inmutable para el próximo corpus común.

## 1. Preimágenes, versiones e intentHash

POS mantiene las preimágenes J1; la ratificación ERP es provisional, no un contrato operativo final. originalContentHash continúa con los ocho campos R4. Se preservan bytes/hash de todos los vectores J1. J2 incorpora preimagen **nueva y propuesta** `pos.journal.resume.v1` descrita abajo; no altera originalContentHash, entryHash, genesisHash o acceptanceDigest.

`intentHash` todavía no está especificado completamente por comando: faltan shapes versionados de venta/NC/abono/movimiento/cierre, campos derivados excluidos e identidad del antecedente/reserva. No se usará en una implementación con un Record<string,any> sin reglas. Próxima decisión requiere una tabla por comando de intención inmutable, precondiciones y resultados asignados en commit; timestamps/IDs reintentados no pueden regenerarse dentro de esa intención. No presentamos el journal como listo para implementar.

Parser de claves duplicadas raw, límites numéricos y corpus de conformidad general siguen pendientes. verify-bytes.py verifica bytes/hash/valor JSON; no es un segundo JCS completo. verify-independent.py ERP conserva su restricción explícita de números.

## 2. Control de cierre y retención

POS confirma el diseño propuesto: Z/manifiesto/sello fuera de la secuencia que sellan. Esta decisión sustituye la redacción previa que incluía el cierre en su propio prefijo. El commit deberá conservar artefactos, membresía, reserva/número, comando/outbox de control y siguiente conjunto conjuntamente. No se modifica ninguna frontera de DB en J2.

Aceptamos separar TTL de snapshot/recibo de importación de la vida de idempotencia financiera y de cierre. ACK no purga originales, aceptaciones, comandos o sellos; archivo/tombstone deberá impedir recreación durante toda vida de reintento acordada. Duración, custodia, restauración del archivo y prueba de durabilidad siguen pendientes con ERP/operación. La frontera Android duplicate eventId señalada sigue siendo brecha, no corregida por este verificador.

## 3. Aceptación e idempotencia

POS conserva acceptanceDigest estable y recomputado sobre artefactos verificados. Scope/closeId y scope/closeEventId deben impedir reutilización divergente por separado; no basta unicidad de la pareja. Auth fresca primero; aceptación existente devuelve su estado aunque cambie activation/cut; para nuevo cierre, guard/CAS y reserva vigentes. No se añade activationId al digest. SEALED, ACCEPTED y APPLIED permanecen distintos. Índices/transacción/retención/carreras ERP aún pendientes; ningún modelo offline prueba esto.

## 4. Etapas y nombres

POS propone futura versión discriminada, con proposedThrough solo para PROGRESS_ONLY y sealedThrough solo para final, prohibiendo ambos a la vez. No se cambia R4 en esta entrega: el candidato R4 sigue con validationStage y su forma anterior. J2 no infiere etapa por presencia de un hash, ni certifica una cola perdida sin sello previo. Versión final/migración requieren respuesta ERP.

## 5. Unicode y arrays

POS mantiene UTF-16 y emisión de pares, sin normalizar cadenas, fechas ni reordenar arrays de cálculo. ERP debe cambiar el comparador de las tres claves de miembros/dependencias a UTF-16 y rechazar Unicode inválido; agregar correcto/invertido y preservar vectores históricos. Los cuatro vectores ERP se conservan sin cambios y se contrastan con el canonicalizador POS de fixtures. No se llama universal al canonicalizador de fixtures de ninguno de los lados.

## 6. Orden del cálculo

Corrección realizada descrita arriba. configuration.calculationInputOrder se liga a configurationHash. No rellena valores históricos faltantes ni acredita configuración exhaustiva/selectores reales. Advance mantiene COLLECTION; dependencias y revisiones históricas no se alimentan al cálculo. Los positivos no suman importes ni ejecutan una fórmula alternativa: prueban selección y clasificación. Equivalencia de importes/anexos requiere las pruebas nativas acordadas en fase posterior, sin corregir cálculo aquí.

## 7. Documentos cerrados, épocas y prefijos

`lineage-vectors.json` contiene dos escenarios independientes, cada uno con archivo previo completo y digest fijado por el contexto de prueba, entregado al verificador como argumento separado. El anclaje no se aprende del documento que se intenta importar. En producción tendría que venir de archivo remoto confiable validado y autenticación existente; aquí es una hipótesis explícita, no prueba de origen ni aceptación ERP.

Archivo previo: venta SALE-CLOSED revisiones 1 y 2, misma identidad/total100, manifiesto previo selecciona revisión2. Nueva operación compuesta: revisión3 de esa venta con pendingBalance50, seguida de Collection50 que la referencia por allocation; ambas entradas tienen el mismo commandId. El cierre nuevo tiene **solo COLLECTION como miembro**; TRANSACTION revisión3 es dependencia READ_ONLY. La revisión2 permanece en manifiesto anterior, su historia nunca se reescribe. No se reabre ni se suma otra vez la venta; no se aplica ningún abono real.

| Escenario | Inicio de cadena y secuencia | Procedencia de revisión3 |
|---|---|---|
| NEW_EPOCH | Genesis de época nueva; posiciones1/2, openSet nuevo | previousContentHash exacto de revisión2 en archivo anterior; no reinicia revisión en1 |
| SAME_EPOCH_SUFFIX | chainHash del prefijo anterior; continúa posiciones3/4, openSet nuevo | Mismo antecedente comprobado; no reinicia secuencia ni genesis |

La nueva preimagen de anclaje es exactamente:

`{domain:"pos.journal.resume.v1",scope,mode,storageEpoch,openSetId,priorStorageEpoch,priorOpenSetId,priorFinalSequence,priorChainHash,priorAcceptanceDigest}`.

Se guarda como `configuration.resumeAnchor` y queda ligada por configurationHash → manifestHash → sealHash → acceptanceDigest. Se publica también su digest/bytes como vector. No se agrega silenciosamente al genesis/entry original. ERP debe ratificar esta ubicación/forma y la fuente confiable del ancla. Importación conserva coordenadas de origen de los documentos antiguos; revisión3 creada después tiene coordenadas nuevas y vínculo al antecedente. Same-epoch suffix solo es válido si esa base/época continúa, nunca para una base perdida.

El verificador reproduce la historia completa del archivo de fixtures desde secuencia1 y valida revisión consecutiva/hash previo; no usa fechas ni confía en max(revision). Después valida la selección explícita de miembro/dependencia contra el corte recorrido. Esto no constituye un protocolo general de páginas/pruebas parciales: anclajes compactos, reanudación de cualquier prefijo, múltiples terminales y recepción de controles requieren diseño adicional. Ambos escenarios parten de un cierre anterior conservado: no prueban recuperar una jornada abierta cuyo final se perdió.

Negativos: antecedente null/revisión reiniciada, archivo alterado conservando raíz confiable, anclaje desconocido, secuencia reiniciada al continuar, reutilización de época nueva/openSet, compañía distinta, dependencia omitida/antigua/duplicada, referencia cerrada en cálculo o miembro y resumeAnchor divergente. Selección sin dependencia prueba la relación allocation→documento; no recalcula deuda.

## 8. Capacidades ERP y próximos acuerdos

Se mantienen los estados reportados por ERP, sin auditoría adicional: Collection/Advance y wallet independiente sin recepción/persistencia demostradas; CAS común pendiente; cuarentena fiscal no reutilizable/reasignación exclusiva y series internas pendientes. POS no inventa receptor ni activa journal/importador. Las definiciones de sesión/pairing/takeover existentes no cambian.

La siguiente respuesta ERP debe: corregir sus comparadores/canonicalización documental; contrastar J2 y su ancla de continuidad; ratificar preimágenes/etapas/retención y pedir lo necesario para perfiles de intención/configuración completos. No autorizar implementación por pasar fixtures.

## Reproducción

Desde la raíz de POS J2 o ZIP: `node docs/pos-recovery-journal/verify-vectors.mjs`, `node docs/pos-recovery-journal/verify-lineage.mjs` y `python3 docs/pos-recovery-journal/verify-bytes.py`. El ZIP también conserva `inputs/pos-recovery-j1-erp-review.zip` para extraer y ejecutar los verificadores ERP originales: verify-review.py seguirá reproduciendo los problemas de **J1/R4 archivados**, no evalúa J2.

No se ejecutan runtime POS, bases, journal, endpoints, pruebas de venta/cierre ni dispositivos. Los resultados y límites se registran en validation.json.
