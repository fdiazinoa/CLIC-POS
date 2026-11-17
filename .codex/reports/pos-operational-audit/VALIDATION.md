# Validación independiente — auditoría operativa POS/ERP

Fecha: 2026-11-17. Coordinador/transcriptor: `/root`. Autor funcional único: `/root/audit_implementation`.

## Revisión funcional evaluada

- ERP base `e6c92bd0b958be104e60943d4c2a821075fc0252`, candidato R2 `7177cb064ae3ed81397c65384063a9246cd3c839`; rama `fix/auditoria-eventos-pos`, PR hacia `clean-erp`.
- POS base `9ceea821dc4909b62b244925eff6a24a6e7427b8`, candidato R2 `a8b936f2cc944322b1e43dce15c5771d0dc64803`; rama `fix/auditoria-eventos-erp`, PR hacia `develop` conforme política específica POS.
- Estos SHA identifican el código sometido a pruebas. Un commit posterior exclusivo de expedientes debe cotejarse independientemente para conservar esta evidencia; no afirma pruebas de código distinto.
- Node v24.11.1/macOS arm64, fixtures aislados, sin datos/cargos productivos. La recomendación CI Node22 no fue ejecutada aquí. No APK, instalación, merge ni migración remota.

## Resultados y autores originales

| Gate | Evaluador independiente | Resultado y límite |
| --- | --- | --- |
| G0 análisis | `/root/audit_review` | PASS estático sobre productores/consumidores; ampliación UUID corroborada |
| G1 plan | `/root/pos_events_contract` y `/root/audit_review` | PASS de plan escrito por `/root`; incluye ratificación de ampliación UUID |
| G2/G3 implementación/review | `/root/audit_review` | PASS R2; 29/29 ERP,17/17 POS reejecutados; diff--check sin errores; R1 FAIL preservado y tres hallazgos resueltos |
| G4 QA integral | `/root/audit_qa` | BLOCKED runtime; software PASS: gate transversal POS256/256, focalizados POS31/31 y ERP65/65, smoke nombre/CSV PASS |
| G5 datos | `/root/audit_sync_validation` | PASS en entorno aislado PostgreSQL17/PGlite, no certifica esquema desplegado |
| G6 integración integral | `/root/audit_sync_validation` | BLOCKED runtime; software/local PASS con16escenarios y4filas únicas conciliadas |
| G7 performance | `/root/audit_performance` | BLOCKED; mediciones exploratorias ejecutadas, sin validación UI/Android/presupuesto remoto |
| G8 release | `/root/audit_release` | BLOCKED / NO ELEGIBLE; informe formal R2 contrastado contra fuentes originales, PR draft obligatorio |

Los autores anteriores conservan su evaluación original; esta tabla es transcripción del coordinador, no autoaprobación. No se usa NA para falta de entorno.

## Comprobaciones ejecutadas

- Developer: lint y build completos ambos exit0, ERP10warnings/POS43warnings iguales al baseline. QA inspeccionó esos logs sin atribuirlos a ejecución independiente propia.
- QA: `node .codex/scripts/workflow-gate.mjs qa --base 9ceea821dc4909b62b244925eff6a24a6e7427b8 --candidate a8b936f2cc944322b1e43dce15c5771d0dc64803 --out /private/tmp/pos-operational-audit-qa-gate.log`:45archivos,256/256,exit0,0skips.
- QA POS: `tsx --test tests/posOperationalAudit.test.ts tests/posOperationalAuditHook.test.ts tests/posOperationalAuditNative.test.ts tests/posInvoiceAuditFlagTransition.test.ts tests/supervisorAuthorizationGuard.test.ts tests/backgroundSyncRecoveryContract.test.ts tests/operationalAcknowledgement.test.ts`:31/31,exit0.
- QA ERP: `npm test -- server/services/posOperationalAudit.test.js server/services/auditTrailService.test.js server/services/posUserAuditDisplay.test.js server/services/posUserDecatalogue.test.js server/services/posUserDecatalogue.sql.test.js server/services/syncInboxBatch.test.js server/services/posSyncEventOutcome.test.js`:65/65,exit0.
- Integración: harness externo `/private/tmp/pos-audit-crossrepo.mts`, helpers POS reales → HTTP router ERP (auth fixture) → PostgreSQL17 real socket-only/Pool12 y PGlite; ambos exit0.16escenarios cubren8POST concurrentes/1fila, ACK perdido, replay cambiado incluso antes de primera proyección, endpoint/inbox mismo ID, scopes, RLS/grants, RECEIVE/huella nativa, migración/rerun/preflight/rollback y nombres UUID tenant-scoped sin reescribir historia. No ejecutó aplicador comercial.
- Offline/almacenamiento: IndexedDB27→28 conserva ventas/Z/traslados; export/reopen del adaptador Capacitor real sobre SQLite/WASM conserva registros. Esto no equivale a hardware Android.
- Autorización: helper diferido y hook SSR cubren auto/supervisor, cancelación/doble clic y contexto cambiado después de última lectura. SSR no prueba lifecycle DOM/Android.
- Steering UUID: nombre histórico/snapshot prioritario, directorio por lote dentro del tenant, usuario ausente conserva ID, lista/CSV comparten enriquecimiento; metadata.entity_name evita un diff de nombre ficticio.

### Fallos conservados y corregidos

R1 (`0c685b3a` ERP / `a3d4063e` POS) recibió FAIL de reviewer: legacy invoice quedaba huérfano al activar Outbox; contexto auth podía cambiar durante última lectura; nombre en afterData generaba diff falso. Se corrigieron, añadieron pruebas y re-review R2 PASS.

Primer gate QA falló por binding better-sqlite3 ausente tras instalación ignore-scripts. QA conservó log FAIL, reconstruyó únicamente esa dependencia en node_modules aislado (exit0), repitió todo el gate sobre el mismo código y obtuvo256/256. No se eliminó prueba ni cambió lockfile/código para ocultarlo.

## Pendientes concretos antes de release

- UI autenticada y Android/WebView reales: captura/autorización, sync idle/activo, offline/reconnect/ACK perdido y upgrade operativo con datos de prueba autorizados.
- POS_MASTER: el transporte dedicado conserva pendientes y no consulta endpoint inexistente; forwarding LAN/Kotlin no está implementado/corroborado por esta tarea. No se salta SyncProfile.
- Receptor/token/device middleware y esquema/RLS/migraciones realmente desplegados no se validaron en producción. Aplicar por procedimiento autorizado ERP/migración antes de actualizar POS.
- Performance: handler sintético p95 baseline0.003208ms/candidato0.053417ms, delta+0.050209ms/+1565.12%; no representa input→paint/UI/disco. G7 no lo usa para aprobar ni fallar presupuesto UI≤50ms. Residuo: cada respaldo históricamente fallido ya recuperado todavía consulta su receipt/ciclo; costo bridge/disco desconocido. ERP dedicado usa2requests/evento; proyección inbox4. Faltan baseline/capturas comparables y presupuesto remoto.
- Rollback: pausar transporte conserva pendientes. Revert POS web manteniendo DB_VERSION28/store aditivo; no bajar IndexedDB ni borrar datos. Extensión SQL puede permanecer compatible; no eliminar acciones/histórico para restaurar constraint antiguo.

## Evidencia local con procedencia

- Review R1: `/private/tmp/pos-operational-audit-review-r1.md`; SHA256 `594e3f008b8b46a7268c02b2bc368da50e1b2bb69af342fcc152d3641f9b5958`.
- Review R2: `/private/tmp/pos-operational-audit-review-r2.md`; SHA256 `4cbc2c800994f1723c8b433b299e8b367b5a08928c208eb6c5564334369d10ec`.
- QA R2: `/private/tmp/pos-operational-audit-qa-r2.md`; SHA256 `49718a527a92fafe502687915ea6cd1735a372d594cff0ceb8a5f80675cd2985`.
- Datos e integración R2: `/private/tmp/pos-operational-audit-sync-r2.md`; SHA256 `6f6383d1b9a82217f95c951a1dd043154009b8cfa6a3cdd55544569921c2f960`.
- Performance R2: `/private/tmp/pos-operational-audit-performance-r2.md`; SHA256 `cb56a0f4585d2f00296e4c6cdb5dc81cc15df1939f66a495abade2677ffc2a2a`.

## Decisión independiente de release

`/root/audit_release` cotejó los informes y sus hashes: **G8 BLOCKED / NO ELEGIBLE**. `verify --stage code` sobre R2 terminó exit1 esperado por gate QA integral BLOCKED; no produjo CODE_VALIDATED ni aprobó APK. Reporte original: `/private/tmp/pos-operational-audit-release-r2.md`; SHA256 `ef00c8a6099ecc5ee8fa1d96d99b3c48ae424f4985a64cb874d893e2e8628084`. La evidencia de software aprobada no habilita merge/despliegue. El cotejo final de commits exclusivamente documentales conservará los SHA funcionales anteriores y su alcance.
