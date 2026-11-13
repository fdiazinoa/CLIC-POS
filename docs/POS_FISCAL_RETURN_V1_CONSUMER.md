# Consumidor POS RETURN/E34 v1 — implementación en revisión

Contrato ERP: `docs/pos-fiscal-return-v1-contract.md`, PR CLIC-ERP #2509,
commit revisado `a61a8ba25635d8d93d682f6aa666ae3413421174`.
Perfil: `ORDINARY_RETURN_DOP_V1`. El ERP sigue en draft y no desplegado.
Base POS: develop + PR #997 (`e45bac7b`); conserva sus recibos y recuperación
para B04. La ruta E34 ordinaria exige el consumidor preparado, nunca reserva legacy.

## Límite que impide declarar el flujo completo

La prueba con API HTTP y PostgreSQL aislados del ERP se detiene en
`FISCAL_RETURN_ACCEPTED_ORIGINAL_REQUIRED`, antes de return/prepare.
prepare exige `originalReference.documentId`, pero el status ordinario SALE del
commit ERP revisado no devuelve ese UUID; sólo lo proyecta para ARTICLE_FORMATS_V2.
El POS no lo deduce del número de ticket ni lo toma de la fixture de laboratorio.
El hilo ERP confirmó el faltante: añadirá el objeto completo originalReference al
status autenticado existente, incluido originalReference.documentId. El SHA corregido
todavía no está publicado. El POS pasa ese objeto completo sin reconstruirlo; si
falta o es null, mantiene el pendiente. Hasta resolverlo,
este trabajo debe permanecer draft: no habilitar ni publicar APK con este flujo.
El intento queda persistido y no hay devolución, pago, inventario ni avance de
consecutivo emitido. Puede existir una reserva nativa PREPARED sin efectos.

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

- 375/375 pruebas en 13 suites acotadas (ver comando siguiente).
- npm run build (tsc -b + Vite) aprobado; advertencia de tamaño de chunks.
- ESLint sobre archivos nuevos y pantallas modificadas: 0 errores, 14 avisos
  no-case-declarations en App. Typecheck y 14 pruebas del consumidor repetidos
  después de formatear los archivos nuevos: aprobados.
- Fixtures SQLite usan CapacitorSQLiteAdapter, NativeFiscalReturnStore,
  FinancialCommit y outbox reales sobre better-sqlite3; red/capacidad simuladas.
- Cubren denegación/offline, doble clic, replay de prepare, rollback nativo,
  revocación de autoridad, parciales con centavos residuales, reapertura de archivo
  y pérdida de respuesta, transporte y estado fiscal incierto consult-only.
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
