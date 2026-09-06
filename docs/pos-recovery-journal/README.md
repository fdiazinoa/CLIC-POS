# POS: journal, commit de cierre y vectores de integridad — propuesta J1

Estado: **PROPOSED / UNAGREED**. Fuente POS `2e200a2ff7854cbb08fa8218cffb09dbdb7bdf57` de `origin/develop`; revisión ERP recibida `a7e490d633dd010a1403676f186ace84004b84a2` (R4 invariantes). Fecha 2026-09-06. Solo documentación y modelos offline, sin migraciones, endpoints, llamadas a DB operacional ni cambios de cálculo. La respuesta POS R3 `c266200` se mantiene como evidencia, aunque su PR todavía no forma parte de esta base.

La propuesta no certifica legacy ni autoriza un cierre: `coverage=UNKNOWN`, `exactZEligible=false`, `closeAuthorization=NOT_GRANTED`. No hay sesión de caja durable demostrada. `openSetId` será pertenencia operacional nueva, no una sesión histórica reconstruida.

## 1. Fronteras reales y brechas

Las referencias son rutas y líneas en el commit fuente, no afirmaciones sobre configuración desplegada. [source-evidence.json](source-evidence.json) conserva hashes SHA256 de los archivos auditados. No se consultaron bases del cliente.

| Fuente exacta | Qué garantiza el código disponible | Brecha y cambio mínimo propuesto |
|---|---|---|
| `services/db/index.ts:11`; `utils/db.ts:1178` | Android selecciona CapacitorSQLite; web IndexedDB. Fachada CRUD delega por llamada | No asumir NetworkAdapter como DB activa por ser terminal esclava. Añadir capacidad explícita de commit operacional; auditar transporte LAN aparte |
| `services/db/DatabaseAdapter.ts:30,95` | FinancialCommitInput permite documentos, eventos e intents; método opcional | No expresa precondiciones, borrados/membresía, revisiones o sello. Nuevo contrato tipado propuesto, no SQL arbitrario |
| `services/db/adapters/CapacitorSQLiteAdapter.ts:226,627,655` | Documentos + outbox + intents en executeSet transaccional o BEGIN/ROLLBACK; cola JS de escrituras | Lecturas previas no están dentro del guard. `ON CONFLICT(event_id) DO NOTHING` puede dejar documento actualizado y evento anterior. Comprobar commandId/hash antes de cualquier upsert dentro de la transacción; CAS de revisiones/serie |
| `App.tsx:9332,9384`; `services/transactionService.ts:499`; `services/sync/SyncFeatureFlags.ts:14` | Venta con flag incluye transactions/history/ledger/tracking/deuda y SALE/PAYMENT. Flag por defecto apagado, admite overrides | No cubre todos los productores ni todo efecto previo; el outbox financiero no es journal operacional. No activar el flag en esta tarea |
| `services/sync/DurableOutboxSchema.ts:2`; `DurableOutboxRepository.ts:49,112`; `DurableOutboxBatchSender.ts:54` | Secuencia AUTOINCREMENT por evento, convertida a Number; leases/estados; reparación legacy puede cambiar ID/payload | Una venta tiene varios eventos; no usar local_sequence como posición de operación ni aggregateVersion=1 como revisión durable. Mantener journal separado e inmutable |
| `services/db/adapters/IndexedDBAdapter.ts:381,415,759` | CRUD por store, fallback localStorage; existe transacción multistore para maestros numerados | No hay commit financiero/jornada equivalente. Crear transacción multistore que falle cerrada para la capacidad exacta, sin fallback parcial. No anunciar éxito en request.onsuccess: esperar oncomplete |
| `services/db/adapters/SQLiteWASMAdapter.ts:91,245`; `LocalStorageAdapter.ts:46`; `NetworkAdapter.ts:142,229` | Adaptadores presentes; no seleccionados por factory actual. Writes por colección/documento, persistencia WASM separada | No certificar por existencia de SQLite o Promise.all. Excluir de exactitud hasta pruebas de backend efectivo |
| `App.tsx:9543` | CashMovement se refleja en UI/localStorage y luego documento + colección | Commit único movimiento/journal antes de publicar UI. Evitar replace de colección obsoleta que pise escritura concurrente |
| `components/AccountReceivableModal.tsx:200,240,284` | Avanza serie, guarda Collection, actualiza documentos/deuda en pasos distintos | Abono + allocations + revisiones de documentos afectados + deuda + serie + journal en una transacción. Anticipo de agenda es Collection, no segunda identidad |
| `services/AgendaService.ts:483,528` | Collection guardada antes de saldo/estado de Activity | Commit Collection + snapshot de vínculo + Activity + journal; recepción ERP aún no demostrada |
| `services/localRefundPersistence.ts:28,54,58,110` | NC, history, inventario y original actualizado por separado; dispara sync | Plan de mutaciones conjunto para creación legítima; restaurador nunca llama este helper. NC cuenta una vez; revisión de original no crea otra venta |
| `services/transactionService.ts:801,838,844` | Wallet, movimiento y cliente separados; referencia puede ser displayId | Transacción conjunta y vínculo/snapshot histórico. Wallet independiente sin receptor ERP demostrado; no sumar con PAYMENT_POSTED otra vez |
| `App.tsx:8979,9131` | Estado fiscal cambia documento local con mismo ID | Registrar revisión operacional solo por cambio de contenido fiscal; no reenviar SALE para respaldarla |
| `App.tsx:10183,10219,10332,10398,10420` | Serie antes del Z; Z antes de impresión/email/red y archivo; elimina movimientos/abonos | Nuevo commit de cierre: Z + manifiesto + membresía + originales conservados + serie + comando técnico + sello, todo o nada. Efectos externos después |
| `server/routes/sync.ts:1494,2337,2378,2515`; `server/services/terminalOperationalState.ts:8` | Maestro LAN tiene transacciones por ruta; reset elimina tablas incluyendo Z/cash y buffers; series se guardan por settings | No equivale al commit de tablet ni respaldo durable. Nuevo journal no puede entrar en reset genérico; participación explícita de ingestión/admin/LAN en guard. No se ejecutó reset |
| `tests/durableOutboxV2.test.ts:13` | Tests usan adaptador SQLite de prueba | No certifican bridge Capacitor, IndexedDB, crashes de proceso o cierre Z real |

## 2. Modelo local propuesto (no tablas creadas)

Un único escritor lógico por ámbito autenticado y base; exclusión real en DB además de cola JS. Ámbito incluye tenant/company/store/terminal canónicos. Alias preservados solo como procedencia. No aceptar ámbito proporcionado por original como autorización.

| Almacén propuesto | Identidad / contenido | Invariante |
|---|---|---|
| recovery_scope_state | scope, storageEpoch UUID, nextSequence decimal, chainHead, currentOpenSetId, coverageOrigin | UUID creado y persistido antes de operar; secuencia por época, no reloj. Época nueva no convierte legacy en completo |
| recovery_open_sets | scope/epoch/openSetId UUID, OPEN o SEALED, previousCloseProof/Id, origen y límites | Un conjunto activo por terminal en este primer diseño; cambio de fecha no lo rota. N conjuntos antiguos no cerrados se reconcilian explícitamente |
| recovery_original_revisions | scope/kind/originalId/revision, originalSchemaVersion, JSON inmutable, previousContentHash, posición y contentHash | Una identidad operacional puede tener historia; nunca sobrescribir una revisión. La revisión seleccionada la prueba el corte, no max(fecha) |
| recovery_journal | scope/epoch/sequence, openSetId, commandId, entry y chainHash | Posición por revisión operacional, no por evento financiero. Un comando puede ocupar varias posiciones consecutivas en un solo commit |
| recovery_commands | scope/commandId UUID, intentHash, resultado con IDs/reserva/posiciones | Mismo comando y hash devuelve resultado persistido; otro hash conflicto antes de escribir. No regenerar eventId al reintentar |
| recovery_close_manifests | scope/closeId, Z original, manifest, valores config/declaración, seal y acceptanceDigest | Miembros únicos por kind/originalId; dependencias fuera de sumas y sin intersección, incluso otra revisión |
| recovery_transport | technicalEventId, immutable payload/reference, receipt/apply/attempts separados | Sin ACK no borrar original. El estado remoto no modifica contenido ni cadena |
| recovery_imports | snapshotId/cut/importId, páginas verificadas, progreso, procedencia y estados remotos | Staging separado; importación no genera eventos financieros ni modifica balances/stock/series |

Los nombres son candidatos. NativeRevisionSchema sigue por acordar: no cambiar silenciosamente el original directo por uno batch. Capturar en el futuro un DTO de respaldo local versionado antes de los serializadores ERP con pérdida; conservar por separado la evidencia efectivamente enviada. Null/ausente/0 distintos. Solo convertir Date válido a ISO UTC al construir ese DTO nuevo; inválido no toma reloj actual. Legacy permanece literal y carencias declaradas.

**Mutaciones:** revision decimal positiva incrementada bajo guard por identidad dentro del ámbito. Al cambiar varias operaciones (abono+documentos afectados, NC+original) producir varias entradas atómicas con mismo commandId. Una revisión de un documento cerrado no cambia el manifiesto anterior: se conserva como historia y contexto del nuevo comando; no añade por sí sola otro miembro monetario. Si no se conoce la revisión precedente, bloquear su edición exacta hasta reconciliar. El mecanismo de importación transporta la época/posición original sin reasignarlas a la base sustituta.

`original.syncStatus` que ya venga en la copia congelada se conserva en su hash. Los nuevos ACK/leases viven en recovery_transport; no se repinta el original inmutable con SYNCED. Una futura exclusión de campos requiere nueva versión explícita, no un filtro oculto. `originalContentHash` no es Record.hash: este último también contiene estados del snapshot ERP.

## 3. Comando operacional y commit local

Interfaz conceptual: `commitOperationalCommand({commandId,intentHash,scope,expectedEpoch,expectedOpenSet,expectedRevisions,expectedSeries,mutations,financialEvents}) -> persistedResult`. No endpoint propuesto aquí. intentHash cubre intención estable previa a asignar secuencia, número o reloj dentro del commit; no debe depender de timestamps regenerados. Mismo comando no puede tener otro documento/pago/importe ni reserva.

1. Preparar intención y validar forma fuera de la transacción; no red, fiscal, impresión ni escrituras por helpers durante esta preparación. Congelar los valores de entrada.
2. En guard de DB: buscar commandId y comparar intentHash antes de tocar documentos. Luego verificar scope/epoch/openSet OPEN, revisiones leídas y propiedad/versión de reservas. Lectura obsoleta rechaza antes de efectos.
3. Asignar posiciones exactas y revisiones, construir bytes/hash y aplicar documentos + efectos legítimos del comando + journal + comandos/outbox en el mismo commit. Serie se lee/avanza aquí, no antes. Ningún await HTTP dentro.
4. Solo tras commit, actualizar UI, notificar a sync en background e imprimir. Si el proceso cae tras commit, consultar commandId devuelve el mismo resultado. Fallo de envío no deshace venta confirmada.

Android puede extender su frontera existente, pero debe resolver read-check-write dentro de la misma exclusión SQL y evitar que otra conexión se cuele. IndexedDB necesita todos los stores y precondiciones en una sola transacción; hash asíncrono debe precalcularse con CAS o diseñarse sin que el navegador cierre la transacción. No asumir que await crypto mantiene vivo IDB. Hay que medir latencia y tamaño con datos representativos antes de elegir la implementación de hash. El pequeño trabajo local durable pertenece al commit; compresión, envío y verificación remota quedan fuera del camino crítico del cobro.

Fallo de cuota/DB significa que no se confirmó esa operación durable. Si un proveedor ya autorizó pago, conservar/reconciliar PaymentIntent; no volver a cobrar. No degradar silenciosamente una jornada certificada a escrituras parciales. En despliegue por etapas, una feature flag nueva apagada separa la capacidad; no se modifica `sqlite_outbox_v2` ni pairing/takeover por esta propuesta.

## 4. Preparación y commit de Z

La lectura para preparar Z debe producir `expectedSetRevision`, configuración y lista exacta de revisiones. El cálculo usa la versión actual congelada, sin corregir sus resultados. El cajero declara sobre ese corte. Si aparece un movimiento mientras declara, rechazar preparación obsoleta y recalcular/confirmar declaración; no cerrar una lista React anterior.

Dentro de un único commit final local: revalidar corte/configuración/reserva; asignar ID técnico UUID nuevo para futuros cierres (legacy `ZR-*` se conserva al recuperar); generar una vez closedAt/openedAt de la fórmula vigente, número permitido y report; guardar valores y hashes, manifiesto, sello y evento técnico estable; marcar membresía/archivo sin borrar originales; cerrar openSet y crear el siguiente en la misma época. No usar `zReports.length+1`. El avance de serie y su espejo se confirman juntos o el espejo es derivado sin autoridad.

La cadena de operaciones excluye el Z/sello que la referencia: **evita ciclo** `chain -> manifest -> seal -> chain`. El sello/control de cierre tiene outbox durable e identidad propia pero no ocupa una posición operacional ni es un miembro de su propio Z. No se borra porque llegó ACK. ERP debe persistirlo y verificarlo como control técnico, sin aplicar ventas otra vez. No crear todavía una ruta para esto.

Tras el commit, impresión/email/red pueden fallar independientemente. Reintento devuelve el mismo Z, número, manifest y seal. No usar la opción actual de reemplazar un Z para modificar uno certificado: cualquier rectificación requiere protocolo aparte. Para aceptación ERP se mantiene auth fresca + búsqueda idempotente primero + CAS final solo si nuevo. Local SEALED no significa ERP ACCEPTED ni APPLIED.

**Corte sin ambigüedad:** POS propone `proposedThrough` para PROGRESS_ONLY y reservar `sealedThrough` para final; es cambio de nombre pendiente ERP, no compatible silenciosamente con R4. Mientras se compara R4, sus reglas siguen vigentes con validationStage obligatorio. El checkpoint es congelado al corte del conjunto; la secuencia global puede continuar después en otro conjunto. La prueba de prefijo incluye todas las posiciones de la época, aunque no todas sumen en ese Z.

**Pérdida antes del sello:** aun si todos los recibos conocidos coinciden, no se conoce la cola nunca enviada. No puede sellarla la tablet sustituta. Esto limita fundamentalmente el objetivo de recuperar una jornada pendiente: se puede rescatar lo recibido, pero no prometer Z exacto sin una prueba previa del final. Tras perder declaración o openedAt generado al cerrar, tampoco se inventan. Nuevo openSet no arregla esa incertidumbre histórica.

## 5. Preimágenes candidatas y vectores

`H(x) = lowercaseHex(SHA256(UTF8(JCS(x))))`. Es digest de contenido, **no firma ni prueba de quién lo produjo**. Autenticidad se mantiene mediante autorización existente, recepción durable y guard; un hash recalculable no prueba ausencia de escrituras. Referencia de canonicalización: [RFC 8785, secciones 3.1–3.2](https://www.rfc-editor.org/rfc/rfc8785.html#section-3). Claves por unidades UTF-16; arrays conservan orden; fechas no se normalizan dentro del hash. Contadores son strings. No redondear importes para hashear. Rechazar valores no JSON o Unicode inválido; recepción futura debe detectar claves duplicadas antes de parsear, no después.

Preimágenes exactas del candidato, con objeto `scope={tenantId,companyId,storeId,terminalId}`:

| Digest | Preimagen |
|---|---|
| originalContentHash (compatible con propuesta ERP R4) | `{scope,storageEpoch,openSetId,sequence,kind,originalId,revision,original}` |
| genesisHash | `{domain:"pos.journal.genesis.v1",scope,storageEpoch}` |
| entryHash | `{domain:"pos.journal.entry.v1",scope,storageEpoch,openSetId,sequence,commandId,originalSchemaVersion,kind,originalId,revision,previousContentHash,originalContentHash}` |
| chainHash(n) | `{domain:"pos.journal.chain.v1",previousChainHash,entryHash}`; secuencia 1 encadena genesisHash |
| configurationHash / declarationHash / reportHash | JCS del objeto histórico completo de cada artefacto, sin wrapper; su schemaVersion se incluye si existe, sin añadirlo a legacy |
| manifestHash | JCS de manifiesto completo, sin meter manifestHash dentro de sí mismo |
| sealHash | `{domain:"pos.open-set.seal.v1",scope,storageEpoch,openSetId,finalSequence,chainHash,manifestHash,closeId,closeEventId}` |
| acceptanceDigest | `{domain:"pos.close.acceptance.v1",scope,closeId,closeEventId,manifestHash,sealHash}` |

`previousContentHash` es null solo para creación probada, no para revisión antigua desconocida. originalSchemaVersion queda ligada por entryHash aun cuando no esté en la preimagen R4 de originalContentHash. La identidad idempotente de aceptación compara acceptanceDigest persistido; no incluye activationId/revisiones de transporte que pueden cambiar al reintentar. Es precisión propuesta para que «mismo ID/hash» tenga un significado único; requiere aprobación ERP.

Orden de members/dependencies: comparación lexicográfica UTF-16 de `(kind,originalId,revision)`; unicidad por `(kind,originalId)` antes de ordenar. Python sorted() sin clave UTF-16 no implementa el mismo orden para todo Unicode. Los vectores incluyen claves numéricas (`"10"` antes de `"2"`) y U+1F600 frente a U+E000; construir un objeto ordenado y luego JSON.stringify puede reordenar claves numéricas, así que no basta como canonicalizador universal.

[vectors.json](vectors.json) contiene bytes canónicos, hex UTF8 y SHA256 calculados, historia con dos revisiones de un movimiento entre dos fechas y un único miembro seleccionado, y sello sin circularidad. Son **objetos sintéticos mínimos para hashing**, no perfiles completos de venta/Z ni importes certificados. [verify-vectors.mjs](verify-vectors.mjs) no importa servicios POS ni escribe bases. Sus negativos alteran contenido, relaciones, miembros, orden y cola; no simulan atomicidad del dispositivo.

## 6. Configuración y declaración que deben acompañar los hashes

No respaldar BusinessConfig entero indiscriminadamente: incluye configuraciones de integraciones que no necesita el cálculo. Perfil explícito por definir y completar con lectura de dependencias. Candidato mínimo de captura: currencies ordenadas (isBase/isEnabled/code/rate/denominaciones), paymentMethods y etiquetas, taxes/taxRate, terminal.operational.defaultTaxIds y políticas fiscales/servicio, opciones de cierre por usuario, moneda base resuelta, cálculo/rounding versionados, zona horaria y locale efectivas. `utils/fiscalBreakdown.ts:147,169,305`, `utils/zReportPaymentSummary.ts:58`, `utils/closeReportOptions.ts:53,146`, `components/ZReportDashboard.tsx:387` muestran dependencias reales. No declarar este inventario exhaustivo hasta probar todas las secciones.

Guardar valores exactos de cashCountedByCurrency, paymentMethodDeclarations, denominationBreakdown, notes y decisiones de fondo/retiro del reportData, más el Z generado completo. expectedCash y totales generados son resultados, no declaraciones. Preservar orden de entradas al cálculo: un manifiesto ordenado por identidad no equivale al orden usado por la fórmula. Propuesta concreta J1: `configuration.calculationInputOrder={transactions,cashMovements,collections}`, cada array contiene `{kind,originalId,revision}` en el orden utilizado. Lo liga configurationHash sin añadir un campo al manifiesto R4; ERP debe ratificar esta ampliación del snapshot de contexto de cálculo. Verificar una entrada por miembro calculable, referencias/revisión exactas y ninguna dependencia contada; WALLET no es entrada autónoma del cálculo actual. Si cambia un orden con efecto de redondeo o desempate, equivalencia no probada. El vector incluye esta forma, pero no certifica el perfil completo de configuración.

HourlySales usa getHours() del runtime y etiquetas usan localeCompare. Restauración en otra zona/locale puede variar anexos. Reimpresión fiel usa anexos persistidos; recalcular exige entorno documentado o adaptación versionada aparte. Los vectores no ejecutan esos anexos.

## 7. Restauración y reanudación separadas

Descargar original + eventos/estados a staging, verificar snapshot/cut/páginas y referencias, conservar IDs y distinguir recibido de aplicado/fallido. Publicar copia local de consulta mediante commit de importación; no insertarla como PENDING en productores existentes ni llamar createTransaction/refund/allocations/fiscal. Estado local propuesto RESTORED_READ_ONLY con provenance y estado ERP separados. Sin aplicación remota demostrada, mostrar pendiente/fallido y consultar; no generar otro evento financiero.

Si queda base local con operaciones no enviadas, conservarlas en su época y su outbox; reconciliar por identidad+revisión+hash, nunca sustituir colección completa. Mismo ID distinto hash es conflicto. Si la base desapareció, expresar unknownTailPossible. Cierre ya recibido devuelve IDs/estado incluso si ACK perdido; no crea otro. Series perdidas en cuarentena no reutilizable; reserva desconocida bloquea emisión, no importación de originales. El mecanismo ERP aún está pendiente.

## 8. Pruebas exigibles y etapas posteriores

| Prueba futura | Criterio concreto |
|---|---|
| Crash en cada write de comando | Antes de commit no hay parte visible; después hay doc/revisión/journal/outbox/serie coherentes; repetir commandId no cambia nada |
| Mismo eventId con otro cuerpo | Conflicto antes de upsert; cubrir diferencia entre adapter test y Capacitor real |
| Abono/NC con varios afectados | O todas las revisiones/allocations/efectos nuevos o ninguno; importación no ejecuta esos efectos |
| Dos escritores/IDB tabs/bridge | CAS impide pérdida de actualización y secuencias repetidas; una cola JS aislada no basta |
| Z mientras llega venta/movimiento/fiscal/config | Preparación vieja rechazada antes de sellar/numerar; nueva operación pertenece al conjunto correcto |
| ACK perdido, aplicación FAILED | Retorno del cierre persistido con mismo digest, sin reaplicación; FAILED sigue visible |
| Descarga cortada, reordenada o repetida | Reanudar snapshot, hash/ordinal/ref verificados; sin duplicados ni mezcla de cortes |
| Medianoche, varios días y solo abonos | Pertenencia por openSet; conservar fórmula/clock capturado; no inventar openedAt perdido |
| Moneda/cambio/STORE_CREDIT/CARD/VOID | Comparar resultados nativos ya exportados; CASH+50 sigue diagnóstico 1050, no aprobado |
| Cola perdida / prefijo ACK completo | Sin sello final nunca exactZEligible; una época nueva no lo corrige |
| Otra empresa/terminal/época/reserva | Rechazo por auth y scope aun si hashes coinciden; rebind existente no rediseñado |
| Cuota, reinicio Android e IDB fallback | Sin éxito parcial; backend degradado no anuncia capacidad exacta |
| LAN reset / config / reparación legacy | No destruye evidencia ni muta historial certificado; procesos incompatibles bloquean capacidad |

Orden propuesto después de ratificación: (A) journal y commit Android detrás de flag apagada con pruebas de crash; (B) productores completos y backend web/LAN o exclusión explícita; (C) respaldo ERP durable/estados/cadena; (D) staging de consulta sin efectos; (E) cierre exacto solo con sello, declaración, configuración y reservas/CAS probados. No empezar por un importador que alimente selectores legacy.

Acuerdos que debe responder ERP: nombres proposedThrough/sealedThrough; preimágenes/versiones/acceptanceDigest; control de sello separado de secuencia para evitar ciclos; conservación de historial y revisión seleccionada; orden UTF-16/vectores independientes; calculationInputOrder dentro de configuration; recepción de tipos faltantes; retención de comandos/sellos sin perder idempotencia; guard y cuarentena de reservas. Ninguna ruta nueva se da por disponible.

## Reproducir esta entrega

Desde la raíz del checkout/ZIP: `node docs/pos-recovery-journal/verify-vectors.mjs` y `python3 docs/pos-recovery-journal/verify-bytes.py`. El segundo calcula SHA256 con Python sobre los bytes guardados y comprueba el valor JSON; no es una segunda implementación completa de JCS. La comprobación de source-evidence requiere el checkout fuente y no está implícita en los hashes de vectores. Véase [ERP_HANDOFF.md](ERP_HANDOFF.md) para los puntos que deben contrastarse, sin instrucciones de despliegue.

El [candidato compatible R4](r4-compatibility-candidate.json) usa estos hashes calculados y metadatos sintéticos de revisión/activación. Se ejecutó `check_close_acceptance_candidate` del ZIP ERP a7e490d6 y devolvió `FINAL_SEAL_COHERENT_NOT_AUTHORIZED`. Para repetir el contraste, cargar el verify-r4.py de ese paquete con Python/runpy y pasarle este JSON. El resultado no aprueba la ampliación J1 de preimágenes ni las condiciones operacionales; las revisiones/activación del ejemplo no fueron emitidas por ERP. [validation.json](validation.json) separa pruebas ejecutadas de pruebas pendientes.
