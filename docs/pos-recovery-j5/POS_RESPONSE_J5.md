# POS J5 — respuesta a ERP J4

Entrada: `pos-recovery-erp-j4-4793f552.zip`, commit ERP `4793f552`, PR CLIC-ERP #2006. Leído primero `response-j4.md`. Base POS `120112f` (incluye J4 `bf03edf`). Solo documentación y pruebas offline. **Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.** Acuerdos provisionales no autorizan implementación ni certifican recuperabilidad.

## Correcciones comprobables

| Campo/variante | J4 recibido | J5 documental |
|---|---|---|
| refundDraft.items[].quantity / originalCartId / id | Límite individual podía admitir 2+2 sobre remainingRefundQuantity=2 | Suma por (producto id, originalCartId) dentro del original seleccionado. Conserva chequeo individual; suma debe ser <= límite. 2+2 y 1+2 rechazados; 1+1 aceptado |
| inventoryPlan.mode=TRACKED | Forma/referencias y delta finito no cero bastaban | Siempre UNSUPPORTED_TRACKED_INVENTORY_PROFILE para SALE/REFUND. +999, -1, +1 y 0 rechazados. No inferir delta=-quantity |
| payments[].changeCurrencyCode | No comprobado en DOP/tasa1 | Si changeAmount>0 requiere DOP explícito. USD, ausencia, null, vacío y dop bloqueados. DOP aceptado; cambio cero no introduce moneda obligatoria |

No se modifica cálculo POS, cantidades originales, signo de reembolso ni payload operacional. CARD/STORE_CREDIT conservan su alcance sintético; CASH +50 sigue diagnóstico no validado. El agregado no acredita que remainingRefundQuantity sea auténtico, actualizado o protegido contra otra devolución concurrente. Las cantidades comparadas son las del subperfil simple, sin conversión UOM: unidades/conversiones/recetas/expansión requieren perfil completo y permanecen no soportadas. NONE declara ausencia de plan; no demuestra que el producto realmente carezca de efectos de inventario. No convertir TRACKED en NONE para eludir el bloqueo.

`../pos-recovery-j4/verify-semantics.mjs` contiene la corrección mínima del verificador. `semantic-rules.json` J5 sustituye la evaluación de reglas J4, cuya copia JSON permanece intacta como antecedente. `verify-regressions.mjs` construye copias, recalcula independientemente los hashes de artifacts e intención y comprueba que validar no muta el objeto. 20 negativos y 11 positivos (incluye ocho publicados). No se actualiza ningún vector ni hash histórico para obtener PASS.

## Intención v2 y numeración: acuerdo provisional POS

executionContext y closeControl son artifacts exactos ligados al hash. closeControl contiene closeId, closeEventId y nextOpenSetId: se asignan y congelan antes de intentHash; no crean Z, consumen series ni activan conjunto. Sus efectos, resultados y números/relojes asignados deben guardarse una sola vez en el futuro commit atómico, junto con membresía/control/outbox y siguiente conjunto. Fallo previo no publica conjunto. Retry idéntico devuelve resultado persistido; mismo commandId con otra intención es conflicto. No regenerar IDs en retry. Unicidad durable todavía requiere evidencia. No traducir v1 silenciosamente ni alterar sus bytes.

| Comando | expectedSeries | Purpose |
|---|---|---|
| SALE_CREATE | Exactamente 1 | TICKET |
| REFUND_CREATE | Exactamente 1 | CREDIT_NOTE |
| COLLECTION_CREATE | Exactamente 1 | PAYMENT_IN |
| BOOKING_ADVANCE_CREATE | 0/1 explícito | NONE con razón/resolver, o ADVANCE_RECEIPT |
| CASH_CREATE | 0 | Sin emisión en esta variante |
| WALLET_POST | 0 | Sin emisión en esta variante |
| FISCAL_REVISION | 0 | Revisión del mismo documento |
| CLOSE_SET | Exactamente 1 | Z_REPORT |

Esta matriz limita variantes candidatas, no describe toda la numeración nativa. reservationId=null declara INTERNAL_EXCLUSIVE; no significa desconocido, reserva perdida, disponibilidad ni autorización. ERP debe probar propietario/ámbito/exclusividad/revisión/límites. String no vacío declara RESERVED y exige reserva durable emitida al ámbito. No normalizar identidad silenciosamente. allocation y expectedSeries deben coincidir exactamente; start<=next<=end, avance 1. Consumir end deja cursor agotado end+1, nunca permiso de emitir fuera del intervalo. Prohibido retroceder o inferir disponibilidad de max conocido o cantidad de cierres.

Multiserie sigue MULTIPLE_SERIES_UNAGREED: no dividir una emisión ticket+NCF en comandos para sortear el límite. POS/ERP deben acordar perfil versionado completo de purposes, relaciones, reservas exactas, precondiciones conjuntas, orden de bloqueo, avances/resultados y crash/retry antes de habilitarla. Razón/resolver declarados no prueban una política confiable.

## Estado de los ocho acuerdos

| # | Acuerdo | Estado POS y pendiente | Responsable |
|---|---|---|---|
| 1 | Intención/IDs/perfiles | Aceptado provisionalmente v2/closeControl; tres huecos corregidos o bloqueados. Perfiles nativos completos y unicidad/commit pendientes de evidencia | POS perfiles/commit por backend; ERP identidad durable y precondiciones |
| 2 | Control/retención | Aceptado provisionalmente Z/control fuera del prefijo, sin purga por ACK. Plazos/custodia/archivo no acordados como servicio | ERP mecanismos; operación política; POS conservación local |
| 3 | acceptanceDigest | Aceptado provisionalmente J2 intacto: auth fresca, lookup existente antes del CAS de cierre nuevo, unicidad closeId/closeEventId. Falta prueba durable | ERP guard/índices/archivo; POS replay de resultado |
| 4 | Nombres de corte | Requiere cambio versionado: proposedThrough progreso, sealedThrough final. R4 permanece intacto; no mezclar versiones | POS y ERP contrato discriminado |
| 5 | UTF-16/JCS | Correcciones aceptadas provisionalmente; corpus general, parser raw con claves duplicadas, números/Unicode límite pendientes | POS y ERP verificadores/librería futura |
| 6 | Captura/orden/configuración/semántica | Requiere perfiles completos y evidencia nativa. Correcciones de este paquete solo cierran tres casos limitados; no exactitud nativa | POS captura/serializadores/oráculo; ERP conservar originales completos |
| 7 | Registro confiable/archivo | Aceptado provisionalmente registro ERP independiente y resumeAnchor; autenticidad, continuidad y archivo pendientes de evidencia | ERP fuente/archivo; POS validación; operación disponibilidad |
| 8 | Canales/CAS/reservas | Pendiente de evidencia, sin nueva implementación | ERP recepción/CAS/reservas; POS productor/commit; operación custodia y resolución |

## Dependencias que permanecen abiertas

- **POS:** perfiles nativos por canal con precisión/rounding/versiones, impuestos/descuentos/FX/crédito/modifiers, UOM/recetas/expansión, planes históricos y campos desconocidos. Configuración histórica de 14 bloques necesita tipos efectivos/versiones/hashes/resolvers y cobertura instrumentada de lecturas. VALUE arbitrario no prueba cobertura; DECLARED_NOT_PROVEN y readCoverage NOT_PROVEN siguen sin autorización. Z/anexos/renderer/activos/locale/impresión requieren equivalencia nativa. No reconstruir openedAt, declaración o annex ausente con defaults actuales. La tolerancia 1e-8 es de fixtures, no política monetaria acordada.
- **ERP + POS, Collection/Advance:** falta demostrar productor/receptor de originales, allocations y heads preservados sin reaplicación. Anticipo de agenda es Collection con bookingActivityId; variante actual allocations vacías/appliedAmountBase=0. Casos con asignaciones requieren otro perfil.
- **ERP + POS, wallet independiente:** falta receptor/canal y snapshot de saldo/moneda/cliente/vínculo histórico, deduplicado sin duplicar pagos; derivado de venta no sustituye fila independiente. Creación/cashback/vínculo ausente siguen fuera.
- **ERP, CAS común:** inventariar y cubrir escritores directos/batch/RPC/admin/series/configuración; demostrar exclusión/revisiones y concurrencia/crash/ACK. POS debe demostrar atomicidad real por backend en una fase autorizada; pruebas de objetos no la acreditan.
- **ERP, fiscal/series:** cuarentena de todo intervalo perdido sin declararlo emitido, reserva desconocida bloqueada; release no sustituye cuarentena. Reasignación no solapada debe ser atómica con propietario/ámbito/tipo/límites/avance. SELECT antes de INSERT no prueba exclusión. INTERNAL_EXCLUSIVE exige mecanismo durable; nunca zReports.length+1. POS conserva IDs/números, no retrocede contadores ni reasigna reservas al restaurar.
- **ERP, raíz:** lectura autenticada de registro durable independiente del ZIP/request, registryRevision estable y recomputación del archivo/artefactos/cadena/selección contra la raíz guardada. Errores propuestos AUTH_REQUIRED, ROOT_SCOPE, UNKNOWN_ROOT, ROOT_NOT_ACCEPTED, ROOT_REVISION_CHANGED, ARCHIVE_UNAVAILABLE, ARCHIVE_CORRUPT, ROOT_BINDING, ANCHOR_DOMAIN, ANCHOR_MODE, ROOT_UNAVAILABLE; no se afirman endpoints desplegados. Nunca fallback al digest del paquete. SAME_EPOCH_SUFFIX necesita continuidad durable física, no solo UUID; NEW_EPOCH no elimina incertidumbre de cola perdida.
- **ERP + operación, archivo/retención/tombstones:** lookup activo/archivo/tombstone antes de recrear; identidad/digest sobreviven TTL de descarga. Tombstone reconoce identidad/conflicto, no reconstruye contenido: archivo ausente es ARCHIVE_UNAVAILABLE. No GC de deduplicación sin corte irrevocable probado para épocas/IDs antiguos. Operación decide custodio, plazos por clase, costo, copias/restauración, RPO/RTO, bajas y disponibilidad; 24h/7d continúan propuestas. ERP debe demostrar índices/transacciones/archivo coherentes.

Recepción ACCEPTED técnica puede coexistir con aplicación FAILED: conservar ambos estados visibles; no reaplicar desde POS ni esconder pendientes. Un prefijo recibido o conteos coincidentes no prueban que toda operación salió de la tablet. No reabrir ventas cerradas ni sumar revisiones históricas. Se reutiliza pairing/takeover existente.

## Reproducción desde ZIP extraído

Requiere Node y Python con jsonschema 4.25.1. Sin red, DB, POS runtime ni dispositivo:

```sh
shasum -a 256 -c SHA256SUMS
python3 docs/pos-recovery-j5/verify-all.py
```

El runner verifica SHA256SUMS ERP, ejecuta sus cinco comandos POS recibidos y seis verificadores ERP sobre el ZIP inalterado, luego los cinco comandos POS actualizados y verify-regressions.mjs. Comprueba historical-sha256.json. `results.json` contiene comandos/salidas del entorno de revisión; ruta Python local es incidental. `--record` regenera resultados solo para una nueva revisión, no durante verificación del ZIP sellado.

verify-j4.mjs ERP sigue reproduciendo los tres huecos sobre su J4 archivado; no debe ejecutarse esperando esos huecos sobre código J5 ni editar su evidencia histórica. El nuevo verificador POS exige rechazo directo. verify-r4.py también requiere jsonschema: intento inicial con Python del sistema falló por dependencia ausente; repetición con entorno 4.25.1 pasó. No lint/build de la app: solo se modificaron documentos y scripts offline, validados con los comandos registrados y git diff --check.

**Resultado: revisión documental reproducible, no recuperabilidad certificada. Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED. Sin autorización de journal, endpoints, migraciones o cambio operacional.**
