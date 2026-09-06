# POS J3: intenciones, perfiles de captura y raíz confiable

Estado **PROPOSED / UNAGREED**. Base POS `989f053` de origin/develop, incluye J2 e4bc10f. Entrada ERP d680fa91 / PR2004, `response-j2.md`. Solo documentos y verificadores offline. No se implementan journal, endpoints, migraciones, fórmulas o pairing/takeover. Legacy **UNKNOWN**, exactZEligible=false, closeAuthorization=NOT_GRANTED.

## Resultado del contraste y ocho acuerdos

SHA256SUMS del paquete recibido y los siete comandos de response-j2.md pasan. Se comprobó la evidencia POS J2 byte a byte contra este checkout. ERP corrige UTF-16 y claves numéricas conservando siete archivos históricos. No hay discrepancia nueva en esos dos puntos ni en calculationInputOrder. El PASS de los modelos sigue sin validar originales nativos completos o un backend distribuido.

| Acuerdo | Posición POS tras ERP J2 | Qué falta y quién decide |
|---|---|---|
| 1. Preimágenes/intención/perfiles | Preimágenes J1/J2 aceptadas provisionalmente sin modificación; J3 define envolturas versionadas por ocho comandos | ERP debe contrastar discriminantes, referencias y perfiles; perfiles nativos abiertos requieren evidencia POS+ERP |
| 2. Control de cierre/retención | Control fuera de su prefijo; no purga por ACK; retención separada de snapshot | ERP+operación: custodia/plazos/tombstones/restauración; POS: pruebas de commit por backend |
| 3. acceptanceDigest | Estable y recomputado; unicidad independiente de closeId y closeEventId; lookup tras auth y antes del CAS de nuevo cierre | ERP: índices/transacción/guard/ACK/crash; nada implementado |
| 4. Nombres del corte | Cambio de versión discriminada pendiente; R4 no se renombra | ERP+POS deben acordar versión y rechazo de mezclas; J3 no cambia wire R4 |
| 5. UTF-16/JCS | Correcciones documentales ERP verificadas, hallazgos atendidos | Parser raw y corpus general aún pendientes; fixtures no son biblioteca de producción |
| 6. calculationInputOrder | Tipos, revisión, cobertura, exclusiones y orden conservado verificados | POS: captura histórica completa y pruebas nativas de selectores/importes/anexos |
| 7. Resume anchor | Forma/ubicación J2 aceptadas provisionalmente | ERP debe proveer registro durable independiente y consulta autenticada; requisitos abajo |
| 8. Capacidades ERP | Recepción Collection/Advance/wallet, CAS y reservas continúan pendientes | ERP debe aportar mecanismo y evidencia; no inferir del SQLite POS |

## Intención versionada por comando

`intent-contract.json` define forma cerrada común y roles obligatorios específicos. `intentHash = SHA256(UTF8(JCS(intent)))`. Se separa de originalContentHash, que necesita posición/revisión final, y de acceptanceDigest del cierre. Cambiar el comando, versión, intención, antecedente, configuración o reserva cambia intentHash. Repetir misma intención preserva todos sus IDs/relojes y bytes.

Campos comunes, todos obligatorios: domain específico, command, version=1, commandId UUID, scope canónico (tenant/company/store/terminal), storageEpoch, openSetId, preparedAt ISO UTC ms fijado una vez, expectedSetRevision decimal string, expectedSeries y artifacts. Series ordenadas por seriesId único: {seriesId,reservationId,expectedRevision,expectedNext}; reservationId=null significa modalidad interna sin reserva, no permiso para emitir ni prueba de seguridad. expectedSeries=[] solo cuando el comando no consume/condiciona números; un perfil semántico debe rechazar lista vacía para un comando numerado. **El verificador de binding no acredita esa precondición.**

Cada referencia de artifact tiene exactamente {role,profileVersion,artifactHash}; hash cubre `{schemaVersion,role,document}` del artifact congelado. Roles ordenados lexicográficamente y exactamente los del comando. No es un objeto de payload libre: cada rol tiene versión y definición semántica abajo. Todas las referencias deben resolverse al contenido correcto; un artifact faltante bloquea. El contenido nativo aún necesita su validador/perfil; comprobar su digest no lo convierte en un original válido.

| Comando/domain sufijo `.v1` | Definición completa propuesta de roles de intención | Resultado asignado al commit, nunca regenerado en retry |
|---|---|---|
| SALE_CREATE / sale_create | saleDraft: Transaction nativa con ID técnico congelado, menos campos asignados listados abajo; inventoryPlan: lista ordenada de deltas con producto/variante/almacén/unidad/cantidad e IDs técnicos; paymentEvidence: lista de PaymentEntry y referencias de intents/proveedor ya existentes | Número/serie permitidos, documentos, revisiones/posiciones/outbox; no vuelve a autorizar pago |
| REFUND_CREATE / refund_create | refundDraft: misma captura Transaction, documentType REFUND; originalBefore: snapshot/revisión/hash/procedencia de venta; inventoryPlan como venta con signo/tipo explícitos; refundEvidence: método y disposición real CARD/STORE_CREDIT y vínculo proveedor | NC y revisión del original/stock legítimos; CASH no validado y VOID comercial quedan bloqueados |
| COLLECTION_CREATE / collection_create | collectionDraft: Collection completa salvo número asignado; allocationPlan: allocations con IDs, importes/FX aplicado/no aplicado; documentsBefore: lista de snapshots y heads de cada documento afectado; customerBefore: snapshot/head de deuda | Collection, revisiones afectadas, deuda y serie en un commit; no duplica cobro por cada allocation |
| BOOKING_ADVANCE_CREATE / booking_advance_create | collectionDraft como anterior con bookingActivityId obligatorio; bookingBefore: Activity histórica y head; customerBefore histórico | Una Collection y estado/saldo Activity, no otro documento ADVANCE paralelo |
| CASH_CREATE / cash_create | cashDraft: CashMovement completo, id/timestamp/moneda/tipo/importe/operador explícitos; fondo requiere movimiento real | Movimiento + revisión/journal, no inventa apertura desde configuración |
| WALLET_POST / wallet_post | walletDraft: WalletTransaction con importe con signo; walletBefore: Wallet/head/moneda/cliente históricos; linkedDocument: snapshot/head o ausencia explícita justificada de vínculo | Saldo/movimiento/cliente legítimos en commit; referencias displayId no convertidas a UUID |
| FISCAL_REVISION / fiscal_revision | originalBefore completo; fiscalResult: resultado observado inmutable (referencias, estado, mensaje, instante observado y proveedor), sin volver a ejecutar solicitud fiscal | Revisión de mismo documento; no evento SALE nuevo |
| CLOSE_SET / close_set | memberSelection: listas explícitas kind/id/revision/hash, dependencias read-only, orden de cálculo y corte; configuration: contexto histórico completo; declaration: campos listados abajo; previousClose: registro/artefactos de cierre precedente o prueba durable PROVEN_FIRST | Reloj de cierre y openedAt fallback fijados una vez, número permitido, Z/manifest/sello/evento, siguiente conjunto; sin circularidad |

Los arrays de planes conservan orden. Heads incluyen ámbito, kind/id, revisión, originalContentHash, epoch/openSet/posición y snapshot; ausencia de head solo en creación probada, nunca para reiniciar identidad conocida. snapshot de documento cerrado no reabre membresía. Planes no ejecutan inventario/cobros durante recuperación. Una entrada de paymentEvidence ya autorizada puede requerir reconciliación si falla el commit; no se reautoriza para repetir un comando.

Campos asignados excluidos de drafts nuevos: displayId/sequenceNumber/seriesNumber cuando todavía no emitidos, nueva revisión operacional, journalSequence, chainHash y metadatos de transporte; closedAt/openedAt fallback se asignan al cierre. IDs técnicos de documentos/pagos/allocations, commandId y preparedAt se fijan antes de preparar intención. Si el documento ya tiene número emitido/fecha histórica (p.ej. originalBefore), esos campos se conservan en su snapshot y digest: la exclusión **no** se aplica al antecedente ni al archivo recuperado. Los importes/tasas/cambio/condiciones elegidas jamás se excluyen. La revisión final y resultados asignados deben guardarse con intentHash en la misma transacción.

Error antes de commit no deja éxito parcial. Retry del mismo commandId con otro intentHash es conflicto antes de cualquier upsert. No volver a calcular preparedAt desde Date.now. expectedSetRevision/expectedSeries forman parte de esta intención de comando: si cambian por conflicto antes de aceptación, preparar explícitamente otro comando; no mutar uno ya confirmado. activationId y datos del intento HTTP quedan fuera. La aceptación de cierre existente se reconoce por acceptanceDigest aunque cambie activación, según J2; no confundir ambos niveles.

**Límite entregado:** los ocho fixtures tienen artifacts sintéticos mínimos para demostrar binding, no documentos semánticos completos. El validador cerrado de intención está especificado; las reglas de cada artifact descritas aquí son propuestas, no schemas nativos certificados. El extractor de declaraciones y perfiles de captura siguientes hacen visibles los campos no tipados en vez de prometer validarlos.

## Perfiles completos de captura frente a validación

`native-closure.json` exporta literalmente todas las declaraciones alcanzables desde las raíces nativas indicadas, incluyendo herencia y referencias; `export-native.cjs` lee types.ts, no importa aplicación. Permite consultar todas las propiedades declaradas sin repetir un schema mínimo a mano. Incluye BusinessConfig/TerminalConfig para auditar dependencias, **no autoriza respaldar sus credenciales**. No es un schema runtime: any, unknown, índices abiertos y extensiones observadas se marcan como brechas. No asignarles nativeSchemaVersion=1 retroactivamente.

`capture-profiles.json` define la política de copia completa por TRANSACTION, CASH_MOVEMENT, COLLECTION, WALLET y Z_REPORT. Para nuevos registros: captura JSON local antes del serializador directo/batch que pierde campos; conservar todas las propiedades observadas en root, items y payments, no solo las conocidas por tipos. Para histórico: conservar exactamente lo recibido; no completar con maestros actuales. Perfiles directos/batch son canales distintos, no intercambiables. Una propiedad desconocida se conserva como evidencia y mantiene validación UNKNOWN hasta clasificarla.

Transaction requiere líneas id de producto + cartId de línea, todos los impuestos/discounts/modifiers/totales y pagos/cambio/monedas originales; REFUND conserva vinculación/representación observada. Collection conserva allocation IDs, heads de referencias cerradas, importes recibido original/base/aplicado/no aplicado/tasa; anticipo comparte Collection. Wallet requiere contexto histórico separado y vínculo verificable. Z captura todo el objeto y anexos, alias y declaraciones persistidas; no vuelve a correr fórmulas para llenar secciones perdidas.

Conversión nueva únicamente declarada: Date válido en PaymentEntry.timestamp → ISO UTC ms al congelar DTO. Strings históricos permanecen literales; null/ausente/cero distintos. Otra ruta Date exige regla versionada explícita. Valores no JSON, no finitos o fecha inválida bloquean la captura exacta, sin convertir a NOW/null silenciosamente. No se cambian redondeos ni dinero nativo. Precisión perdida antes de parsear no se recupera. Un parser raw con rechazo de claves duplicadas sigue pendiente.

### Contexto histórico de cálculo y declaración

Perfil propuesto `pos.calculation-context.j3` incluye **todos** los bloques requeridos en capture-profiles.json. Cada bloque debe conservar presencia explícita y valor efectivo: ABSENT y NULL no son cero/default. Guardar el default realmente resuelto y versión del resolver cuando se utilizó, nunca el default del equipo nuevo.

- currencies: CurrencyConfig[] completa en orden, tasas duales y políticas de cambio.
- paymentMethods: todos los campos PaymentMethodDefinition salvo integrationConfig, exclusión explícita de este perfil nuevo; id/name/type/rounding/etc se conservan. Credenciales no necesarias para sumar no se exportan.
- taxes/taxRate, ambas variantes serviceTaxPolicies, defaultTaxIds de terminal y políticas de servicio efectivas.
- opciones efectivas de fondo, denominaciones, secciones por operador y valores fuente; resolvedBaseCurrency y entorno effectiveTimeZone/effectiveLocale.
- sourceVersions: hashes del selector y cada helper usado; calculationInputOrder y resumeAnchor completo de J2 (o prueba PROVEN_FIRST); readCoverage de cada acceso a configuración.

La captura debe fallar la capacidad exacta si una rutina lee un campo no cubierto. Esa instrumentación/dependency closure aún no existe; por tanto **el perfil de configuración no se declara exhaustivamente validado para todos los anexos/impresión**. Evidencia de dependencias actual: ZReportDashboard.tsx:387, utils/zReportPaymentSummary.ts:25, utils/fiscalBreakdown.ts:145/169/306 y utils/closeReportOptions.ts:39/146. No se sustituye la configuración histórica por la vigente.

Declaración propuesta: cashCountedByCurrency, paymentMethodDeclarations, denominationBreakdown, notes, requireCashFundOnZ, fixedCashFundAmount, cashToLeaveInDrawer y cashToWithdraw, con presencia/valor exactos y operador/contexto. Los expected/system totals son salida del cálculo y van en Z, no se disfrazan de declaración. Conservar cada campo adicional observado con validación pendiente. Reimpresión exacta exige además print-context de información pública de empresa/receipt/assets/layout/locale y anexos persistidos; no implica volver a enviar a fiscal/email/impresora durante importación. Matriz completa del renderer y muestras autorizadas por canal pendientes POS+ERP.

## Retención y fuente confiable: requisitos de aceptación

| Elemento | Requisito POS propuesto | Decisión/evidencia ERP requerida |
|---|---|---|
| Snapshot/páginas | TTL puede vencer; descarga vencida vuelve a pedir snapshot y no mezcla cortes | Límites/plazo/SLA concretos, sin reutilizar TTL para borrar deduplicación |
| Comando/aceptación | Conservar scope, commandId/intentHash, closeId y closeEventId por separado, acceptanceDigest, resultado estable y relación a archivo | Retención sin caducidad automática hasta política acordada; índices y restore de archivo |
| Originales/sello/config/declaración | Archivo durable verificable completo, no purga por ACK | Custodia, replicación/restauración y pruebas de pérdida de nodo |
| Tombstone | Impide reutilizar IDs/digests; conserva estado/identidad mínima y archivo localizable | No alcanza para restaurar si faltan artefactos; responder ARCHIVE_UNAVAILABLE, nunca permiso exacto |
| Fuente de raíz | Registro ERP de aceptación técnica, scope y artefactos del cierre anterior, independiente del import | Identificar persistencia y consulta autenticada reales; hoy no demostradas |

No fijo plazos legales ni de negocio sin decisión de operación. Propuesta técnica conservadora: sin eliminación automática de identidad/aceptación mientras un dispositivo/archivo pueda reintentar; reducción de originales solo tras política que mantenga recuperabilidad requerida. Si ERP desea caducidad, debe definir también cómo se impide recrear un comando/cierre antiguo después del vencimiento.

Flujo lógico de raíz, **sin declarar ruta HTTP disponible**:

1. Revalidar credencial/ámbito con mecanismo existente. Consultar un registro ERP de aceptación anterior por identidad explícita; no por máximo de fecha, ni tomar raíz esperada del paquete/importador.
2. Registro devuelve registryId/revision, scope, closeId/closeEventId, acceptanceDigest, epoch/openSet/finalSequence/chainHash, estado de aceptación técnica y localizador/hash del archivo completo. Recibido comercialmente no equivale a ACCEPTED técnico. Application puede seguir FAILED.
3. Obtener archivo y recomputar configuración/report/manifiesto/sello/acceptance y cadena/antecedentes. Comparar con raíz del registro independiente, pertenencia histórica y previousClose explícito. Digest enviado por cliente no sustituye comparación.
4. Validar que NEW_EPOCH realmente creó base nueva; SAME_EPOCH_SUFFIX requiere estado durable de esa misma base y nextSequence, no basta el ZIP. No demostrar continuidad de una base perdida mediante cached root sin procedencia comprobada.
5. Registry inaccesible/UNKNOWN, archivo ausente/inconsistente, scope distinto, aceptación no técnica o relación de cierre incorrecta: conservar lectura/diagnóstico, bloquear edición/restauración exacta. Reintentar consulta, nunca fallback a raíz del mismo paquete.

El test J3 suministra un registry de fixtures como contexto separado. Prueba rechazo de raíz desconocida/ámbito/cadena/posición distintos, recepción sin aceptación y tombstone sin archivo. No prueba autenticidad del registry ni verifica todo el archivo; esa función no puede convertirse en cliente de producción. No existe evidencia nueva de endpoints desplegados.

## Dependencias ERP que bloquean implementación

ERP debe responder separadamente: (a) emisor/receptor/almacenamiento original de Collection/Advance y wallet independiente; (b) registro de aceptación y camino confiable de consulta de raíz; (c) guard/CAS común para todos los escritores y pruebas multi-conexión/crash; (d) cuarentena no reutilizable del intervalo fiscal perdido y reservas no solapadas transaccionales; (e) exclusividad de series internas; (f) políticas concretas de retención/archivo/tombstone. release, SELECT previo a INSERT y contadores máximos conocidos siguen sin resolverlo.

POS propone ocho bindings de intención y perfiles de captura nuevos, no adopción unilateral de wire. Aún debe cerrar validadores semánticos de drafts/planes, muestras nativas por canal, dependencia completa del cálculo/impresión, pruebas atómicas Android/web/LAN y ajustes de productores. COMMERCIAL_VOID y CASH_REFUND_UNVERIFIED permanecen fuera de comandos aprobables; F04=1050 es diagnóstico. Ningún dato legacy se convierte a exacto por estos artefactos.

## Reproducción

Ejecutar `node docs/pos-recovery-j3/verify-contract.mjs` y `python3 docs/pos-recovery-j3/verify-bytes.py` desde la raíz del ZIP/checkout. Exportación de tipos opcional: con TypeScript disponible, `node docs/pos-recovery-j3/export-native.cjs` desde el checkout genera inventario para comparar, sin modificar originales. Los scripts de binding prueban forma/hashes/referencias, no semántica monetaria.

El ZIP incluye el paquete ERP d680fa91 original bajo inputs para repetir exactamente los siete comandos recibidos. validation.json registra evidencia y límites. No se ejecutaron procesos operacionales o dispositivos.
