# Consumidor POS RETURN/E34 v1 — implementación en revisión

Contrato ERP: `docs/pos-fiscal-return-v1-contract.md`, perfil `ORDINARY_RETURN_DOP_V1`,
PR CLIC-ERP #2509. Integración actual fijada a
`e0a57705579a317b03e6bff0bf97ef85bdab60d5`, que incluye referencia original autenticada
(05d9bc92) y el contrato aditivo de digest wire. ERP continúa en draft y sin desplegar.
Base POS: develop + PR #997 (`e45bac7b`); conserva recibos y recuperación para B04.
E34 ordinaria exige el consumidor preparado, nunca reserva legacy.

## Contrato consumido y alcance de la comprobación

El POS toma `originalReference` completo del status autenticado, sin reconstrucción.
Una referencia ausente/null conserva el intento pendiente y su `originalReferenceReason`
seguro. A igual versión fiscal, sólo la referencia y su diagnóstico se refrescan como
metadatos transitorios; estado/firma/decisión deben coincidir exactamente y el sidecar
SQLite no se sobrescribe. Una referencia null nueva prevalece sobre la cacheada.
La modificación se limita a ordinary SALE; VOID conserva su referencia a la afectada.

La preparación exige el esquema exacto
`ERP_POS_FISCAL_RETURN_V1_PG_CANONICAL_UTF8_SHA256_V1` y verifica SHA256 de los bytes
UTF-8 de `returnSnapshotDigestInput` tal como se recibieron, antes de parsearlo.
No hace trim, normalización Unicode ni JSON.stringify para reconstruir el digest.
Después comprueba el sobre exacto schemaVersion/source/value y compara value contra
el snapshot con tipos/keys/orden de arrays/números finitos e enteros seguros. Mantiene
los validadores monetarios y de líneas anteriores. Usa JSON.parse como el contrato
publicado; no afirma rechazo léxico adicional de claves duplicadas. El recorrido de
valores es iterativo y el tamaño del input está limitado como la respuesta HTTP.

Los dos campos wire son sólo DTO, nunca entran al snapshot, contrato fiscal de seis
campos, identidad financiera, pagos o eventos. Preparaciones históricas sin esos
campos se recuperan repitiendo el comando durable exacto: se exige igualdad de todo
el DTO anterior salvo los dos campos nuevos y se guarda únicamente un suplemento
write-once en el intento. El snapshot/digest/DTO original, IDs, checkout, source y
localCommittedAt permanecen intactos. Trigger adicional protege el suplemento; no
se relajan los triggers anteriores ni la recuperación de operaciones COMMITTED.
Una prueba ausente, parcial, desconocida o alterada mantiene pendiente sin efectos.

La integración real aislada ya completa consumidor POS -> adaptador SQLite nativo ->
FinancialCommit/outbox -> HTTP/PostgreSQL ERP -> worker con proveedor simulado.
Comprueba un receipt/fence, un ISSUE, pérdida de respuesta y sólo GET hasta ACCEPTED;
conserva pruebas de pago antes de NC, inventario antes/después y eventos/ACK repetidos.
Esto NO equivale a aceptación real de MSeller/DGII ni prueba Android/WebView.

Para usar las fixtures antiguas con los componentes reales se cargó la migración
publicada de fingerprint de token en la base privada. Se concilia sólo track_id de la
venta sintética con su OBSERVATION retenida; la referencia sigue viniendo del endpoint
real. El POS-fixture deriva su metadato local root de baseline desde la autoridad de
línea intacta y exige que financialIdentity/fiscalStatusSourceChecksum sean idénticos
al original ERP. Usa los helpers reales v3InventoryBaselineKey y toDurableWireEvent,
sin sustituir validadores, auth ni generador de referencia. ERP source no se editó.
El hint Supabase opcional de laboratorio no dispone client.channel; quedó registrado,
y la consulta HTTP recuperó el estado. Realtime real no está validado.
El runner de integración registra una prueba node:test y usa test-force-exit tras
await de cleanup de HTTP/PG por temporizadores importados de la aplicación. No
equivale a una prueba de cierre/reinicio de proceso Android.

## Persistencia y recuperación

`pos_fiscal_return_attempts_v1` conserva comando, operación, IDs de pagos y eventos
antes de prepare. Sus fases son WAITING_AUTHORITY, PREPARING, PREPARED, SEALED y
COMMITTED; los triggers impiden cambiar identidades y contenido ya sellado.
El checkout mantiene su fecha de nacimiento; localCommittedAt se fija una sola vez.
Una nueva confirmación comprueba admisión, autoridad y vigencia. Source, historial,
original afectado, movimientos, numeración emitida y outbox se confirman juntos en
la transacción SQLite existente. El snapshot y paymentCommands provienen de prepare.
La entrega usa la capacidad de transporte anunciada, con los mismos eventos
SALES_CREDIT_NOTE_POSTED/PAYMENT_POSTED. Sólo un ACK APPLIED_ERP de ambos eventos
libera el checkout para una devolución parcial posterior. Un commit con respuesta
perdida se recupera incluso offline, sin nueva preparación ni efectos.

El POS sólo consulta el workflow. Valida semánticamente PREPARED frente a WORKFLOW,
referencia, checksum, digest, versiones y transiciones. Firma no significa aceptación
DGII. No añade ISSUE. La UI no ejecuta reembolso bancario legacy antes de preparar E34;
los gateways no soportados permanecen pendientes sin efecto bancario.

## Evidencia y límites

- 406/406 pruebas en 14 suites acotadas (ver comando siguiente).
- Revisión posterior acota el metadato nuevo únicamente a ordinary SALE; VOID y
  el perfil sin operationKind conservan su referencia a la factura afectada.
  Las 20 pruebas del consumidor y typecheck/lint se repitieron: aprobados.
- npm run build (tsc -b + Vite) aprobado; advertencia de tamaño de chunks.
- ESLint sobre archivos nuevos y pantallas modificadas: 0 errores, 14 avisos
  no-case-declarations en App en la revisión anterior. En este seguimiento, ESLint
  de los seis archivos funcionales/pruebas modificados: 0 errores y 0 avisos.
  Typecheck y compilación repetidos: aprobados.
- Fixtures SQLite usan CapacitorSQLiteAdapter, NativeFiscalReturnStore,
  FinancialCommit y outbox reales sobre better-sqlite3; red/capacidad simuladas.
- Cubren denegación/offline, doble clic, replay de prepare, rollback nativo,
  revocación de autoridad, parciales con centavos residuales, reapertura de archivo
  y pérdida de respuesta, transporte y estado fiscal incierto consult-only. Las tres
  regresiones nuevas verifican referencia nula/válida a igual versión, retiro de la
  referencia cacheada, rechazo de versión anterior/cambio de core/perfil/scope/checksum
  y diagnóstico ERP seguro sin efectos.
- La integración HTTP/PostgreSQL aislada completó el flujo descrito. Proveedor
  simulado; no demuestra despliegue ERP, MSeller real, Realtime ni Android.
- No se ejecutó Android/Capacitor en dispositivo ni se generó/instaló APK.
- No se modificaron ni conciliaron E340000000003 y E340000000006.
- Una suite adicional fiscalWorkflowV2Native encontró un ReferenceError dbAdapter
  en el contexto extraído del callback POSInterface (archivo no modificado aquí).
  No se cambió esa fixture ni se presenta como una prueba verde.

```sh
npx tsx --test --test-force-exit tests/fiscalReturnDigestWire.test.ts tests/fiscalReturnConsumer.test.ts tests/refundNumberRetry.test.ts tests/refundFiscalReservation.test.ts tests/largeMasterSyncV3FinancialAtomic.test.ts tests/offlineFiscalAllocation.test.ts tests/durableOutboxV2.test.ts tests/durableOutboxBatchSender.test.ts tests/posUiRegressionGuards.test.ts tests/v3RefundOriginalSnapshot.test.ts tests/v3RetainedTaxClassification.test.ts tests/fiscalDispatchLocalCatalog.test.ts tests/fiscalErpDispatch.test.ts tests/erpRefundSource.test.ts
npm run build
```

El runner unitario usa test-force-exit por temporizadores de módulos de aplicación;
no equivale a probar cierre/reinicio de un proceso Android. La reapertura de SQLite
sí se prueba con el archivo persistido y nuevas instancias del adaptador.
La integración opcional `tests/integration/fiscalReturnErp.ts` requiere un checkout
ERP local fijado al contrato y arranca una base privada, sin datos de producción:

```sh
env -i PATH='/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' LANG=C SYNC_BATCH_INBOX_ENABLED=true CLIC_RETURN_TEST_ERP_ROOT=/tmp/clic-erp-return-consumer-fixture /usr/local/bin/node node_modules/tsx/dist/cli.mjs --test --test-force-exit tests/integration/fiscalReturnErp.ts
```
