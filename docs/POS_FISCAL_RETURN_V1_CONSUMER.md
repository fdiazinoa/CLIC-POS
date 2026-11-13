# Consumidor POS RETURN/E34 v1 — implementación en revisión

Contrato ERP: `docs/pos-fiscal-return-v1-contract.md`, PR CLIC-ERP #2509,
commit inicial `a61a8ba25635d8d93d682f6aa666ae3413421174`; referencia original
actualizada a `05d9bc9204fcc11bfe179f9dabc52ff80c2ee9f9`, documentada en
`docs/return-original-reference.md` del ERP.
Perfil: `ORDINARY_RETURN_DOP_V1`. El ERP sigue en draft y no desplegado.
Base POS: develop + PR #997 (`e45bac7b`); conserva sus recibos y recuperación
para B04. La ruta E34 ordinaria exige el consumidor preparado, nunca reserva legacy.

## Límite que impide declarar el flujo completo

La referencia original ya se obtiene del endpoint autenticado del ERP05d9. El POS
pasa el objeto completo sin reconstruirlo. Una referencia ausente/null conserva el
intento pendiente y su código `originalReferenceReason` seguro; no altera la decisión,
firma ni motivo fiscal original. Si llega una referencia nueva a igual versión fiscal,
se utiliza como metadato autenticado transitorio, sin sobrescribir el sidecar SQLite.
El estado fiscal debe coincidir exactamente; versión anterior o evidencia contradictoria
bloquean. Un null nuevo siempre prevalece sobre una referencia cacheada.

La integración HTTP/PostgreSQL real ahora alcanza `return/prepare` (HTTP200), pero
la verificación estricta de `returnSnapshotDigest` detiene el commit local con
`FISCAL_RETURN_PROOF_INVALID`. En la fuente ERP05d9, `pos_return_hash_v1` utiliza el
canonicalizador PostgreSQL, que conserva escala numérica: por ejemplo,
`"discountAmount":0.00`. El snapshot transmitido y parseado en JavaScript contiene
el número0, cuyo JSON canónico es `"discountAmount":0`. Son bytes y hashes distintos.
El POS no omite el digest ni normaliza campos a ciegas para simular compatibilidad.
Hace falta que ERP documente y publique una representación canónica reproducible
del snapshot por el consumidor HTTP. Hasta comprobar ese contrato y terminar la
integración, el PR permanece draft y no es apto para merge ni APK.

La fixture antigua del ERP tenía trackId en OBSERVATION y no en su workflow original;
el endpoint real devolvió `FISCAL_ORIGINAL_REFERENCE_OBSERVATION_MISMATCH`. La prueba
reconcilia únicamente ese dato sintético con su evidencia ya retenida y obtiene la
referencia del verificador real. No inyecta documentId ni originalReference al POS.
Se comprueba igualdad del objeto autenticado contra el enviado a prepare y cero
inventario/outbox/avance de numeración emitida al detenerse en el digest. Puede existir
una reserva PREPARED sin efectos y una preparación remota pendiente; no se libera ni
se reemplaza automáticamente durante un reintento.

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

- 378/378 pruebas en 13 suites acotadas (ver comando siguiente).
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
- La integración HTTP/PostgreSQL real NO completó E34 por el bloqueo documentado;
  no demuestra todavía un ISSUE único de extremo a extremo ni orden de recepción
  real de pago/inventario. Las comprobaciones posteriores quedan pendientes.
- No se ejecutó Android/Capacitor en dispositivo ni se generó/instaló APK.
- No se modificaron ni conciliaron E340000000003 y E340000000006.
- Una suite adicional fiscalWorkflowV2Native encontró un ReferenceError dbAdapter
  en el contexto extraído del callback POSInterface (archivo no modificado aquí).
  No se cambió esa fixture ni se presenta como una prueba verde.

```sh
npx tsx --test --test-force-exit tests/fiscalReturnConsumer.test.ts tests/refundNumberRetry.test.ts tests/refundFiscalReservation.test.ts tests/largeMasterSyncV3FinancialAtomic.test.ts tests/offlineFiscalAllocation.test.ts tests/durableOutboxV2.test.ts tests/durableOutboxBatchSender.test.ts tests/posUiRegressionGuards.test.ts tests/v3RefundOriginalSnapshot.test.ts tests/v3RetainedTaxClassification.test.ts tests/fiscalDispatchLocalCatalog.test.ts tests/fiscalErpDispatch.test.ts tests/erpRefundSource.test.ts
npm run build
```

El runner unitario usa test-force-exit por temporizadores de módulos de aplicación;
no equivale a probar cierre/reinicio de un proceso Android. La reapertura de SQLite
sí se prueba con el archivo persistido y nuevas instancias del adaptador.
La integración opcional `tests/integration/fiscalReturnErp.ts` requiere un checkout
ERP local fijado al contrato y arranca una base privada, sin datos de producción:

```sh
env -i PATH='/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' LANG=C SYNC_BATCH_INBOX_ENABLED=true CLIC_RETURN_TEST_ERP_ROOT=/tmp/clic-erp-return-consumer-fixture /usr/local/bin/node node_modules/tsx/dist/cli.mjs tests/integration/fiscalReturnErp.ts
```
