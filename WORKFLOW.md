# Workflow permanente multiagente CLIC-POS

REQUEST → ANALYSIS → PLAN → IMPLEMENTATION → CODE REVIEW → QA → SYNC VALIDATION/PERFORMANCE cuando apliquen → INTERNAL RELEASE GATE → INTERNAL DEPLOY → INTERNAL TESTING → PRODUCTION RELEASE.

## Constitución y activación

Aplica a funcionalidad, bug, optimización, refactor/arquitectura, sync/DB/Android/WebView/integración. Coordinador orchestrator recibe prompt y delega roles independientes; no modifica código funcional. Solo developer implementa plan aprobado y entrega IMPLEMENTATION COMPLETED, sin BUG FIXED/QA PASS/PERFORMANCE PASS/READY FOR RELEASE. Ningún agente aprueba trabajo propio. Solo un escritor por archivo; reviewer/QA/sync/performance pueden paralelizar candidato congelado, sin saltar dependencias. Falta de agente o ambiente = BLOCKED.

Los nueve Markdown bajo .codex/agents definen contratos y los TOML adyacentes registran agentes en clientes compatibles según [documentación oficial](https://learn.chatgpt.com/docs/agent-configuration/subagents), contrastada 2026-09-16. Si no hay selección nativa de rol, leer y delegar instrucciones completas a sesión distinta, registrar sessionId real y limitación. No son servicios residentes ni garantía de permisos/carga cliente; confiar proyecto/nueva sesión puede ser necesario.

El prompt normal inicia coordinación cuando checkout contiene AGENTS; no crea por sí mismo procesos permanentes ni publica APK. Los comandos locales son obligatorios por instrucciones; no hay hook que intercepte todas las ediciones. Esta instalación no modifica branch protection/CI APK existente ni .env global.

## Auditoría y plan

Leer siete mapas en docs/architecture, inventario y CLOUD_ADMIN_DEPLOYMENT; corroborar código actual. Base de auditoría 669f9624c85de40129169e6779aa6983f1441fea. Analyst distingue SYMPTOM/EVIDENCE/ROOT CAUSE (o hipótesis)/PROPOSED CHANGE/RISK/VALIDATION REQUIRED; incluye callers/almacén/eventos/side effects y criterio de aceptación cuantitativo. Plan recibe aprobador independiente del analista y registro base/SHA. No cambiar código durante auditoría.

Git: fetch origin develop; congelar SHA base; crear feature/<modulo>-<tarea> o fix/<modulo>-<bug> desde esa base (hotfix urgencias). Principal para código; si está conflictivo/sucio con trabajo ajeno, worktree aislada desde develop y registrar excepción sin resolver conflictos ajenos. Commits Conventional mínimos → checks → push → PR develop. Prohibido push main/merge directo main; revert merge fallido mediante rama/PR urgente. Develop fuente oficial APK, signed worktree solo build, limpia/alineada y versiones monotónicas/formalizadas conforme protocolos y constitución.

## Matriz automática conservadora

`workflow-gate.mjs plan --base BASE_SHA --candidate SHA --out /tmp/task-plan.json` lee diff committed. Antes de implementación aún sin candidato, `plan --base BASE_SHA --candidate BASE_SHA --critical` ofrece selección preventiva y el analyst define matriz por plan; selección final se reconfirma tras commit. Siempre base ancestro y SHA congelado.

| Fuente real de impacto | Riesgo / módulos | Agentes y validación automática |
|---|---|---|
| Documentación arquitectura pura | LOW/procedure | Analyst/plan/reviewer/QA documental, enlaces/contratos; no APK |
| AGENTS/WORKFLOW/.codex roles/gates | HIGH/procedure | Review y QA del procedimiento/tooling/formatos/etapas; no asumir tests POS runtime |
| Favicon declarado en index.html | MEDIUM/UI | Review/QA visual; selector conserva suite transversal por seguridad |
| App/types/constants/config/dependencias/build/DB o ruta desconocida | CRITICAL o HIGH/shared | Todas las suites críticas transversales, QA/offline/sync-validator/performance |
| POS/cart/transaction/payment/tax/promotion/credit | CRITICAL o HIGH/sales/payments | QA sales/payments/tickets/functional/regression; sync/offline/performance conservadores |
| TableMap/TableMove/tabla integrity/restaurant | HIGH/tables | QA tables/sales/payments/tickets + performance y sync/offline por dependencias master |
| TicketHistory/ticket/closed membership/Z/print | HIGH o CRITICAL | QA tickets/Z/print/transacciones, sync/offline/performance conservadores |
| services/sync/db/auth, useOffline*, masterOperational/credentials/identity, server/routes/sync | CRITICAL o HIGH | Sync-validator independiente ONLINE/OFFLINE/reconnect/both directions/retry/order/idempotency/leases + QA/offline/performance |
| android/native-stubs/capacitor/WebView | HIGH o CRITICAL/device | Suite crítica + gate device QA en hardware y performance/sync; Node/Kotlin no asumidos iguales |

No módulo crítico ventas/cobros/tickets/mesas/Z/offline/sync/Outbox/Inbox/DB/auth es LOW. affectedModules es información de impacto; no reduce pruebas automáticamente. Conservamos 45 suites/tests transversales previos para todo cambio fuera del procedimiento, más Android contracts si device. UI aislada sin consumidores críticos debe demostrarse, nunca inferirse por nombre. Analyst/reviewer/QA/sync pueden ampliar gates con additionalRequiredGates/--critical; requiredGates no se resta. checklists sales/payments/tables/tickets agregadas; Z/print/auth siguen functional/regression/release. Suite catálogo test:catalog-sync se añade si impacto.

## Estados, dueño y evidencia

Todo estado pertenece a expediente taskId/base/candidate/roles/manifest; no basta cambiar una palabra. Estados sin gates completos no autorizan acción. BLOCKED conserva lastValidState, failedStage, motivo/acceso faltante y evidencia; retomar solo cuando condición cambie y repetir gates pertinentes. FAIL vuelve a implementación→review→validación, no eliminar tests/métricas ni saltar fases. Nuevos SHA/checksum/build invalidan toda aprobación posterior; source post-merge/build se reconfirma antes de release.

| Estado | Quién establece | Evidencia / condición |
|---|---|---|
| NEW | orchestrator | REQUEST/alcance/entorno autorizado |
| ANALYZING | orchestrator→analyst | base SHA, inventario y reproducción/contexto |
| PLAN_READY | analyst | diagnóstico + plan/matriz/baseline/criterios/rollback, pendiente aprobación independiente |
| IMPLEMENTING | orchestrator→developer | aprobación de plan por identidad distinta del analista |
| REVIEW | orchestrator→reviewer | IMPLEMENTATION COMPLETED, diff/commits/checks candidate congelado |
| REVIEW_FAILED | reviewer | hallazgo/evidencia; volver implementación y nueva revisión |
| QA | orchestrator→QA | reviewer PASS; checklist/suite/esperado-observado; runtime si pertinente |
| QA_FAILED | QA | reproducción/logs; vuelta implementación/review/QA |
| SYNC_VALIDATION | orchestrator→sync-validator | matriz lo exige; ambos sentidos/online-offline/order/consistencia |
| PERFORMANCE | orchestrator→performance | baseline/candidate comparables y funcionalidad QA validada para release |
| APPROVED_FOR_INTERNAL_TESTING | orchestrator independiente | code gates y build aprobado por release independiente, manifest exacto, verify --stage internal PASS |
| INTERNAL_DEPLOYING | internal-deploy | aprobación interna, proveedor/canal/contrato/permisos reales; de lo contrario BLOCKED |
| INTERNAL_TESTING | orchestrator tras deploy | metadata internal_testing y storage/download/UI verificados para artefacto; verify deployment PASS |
| INTERNAL_TESTING_PASSED | QA interna independiente | mismo APK descargado/probado, escenarios/cohortes/topologías/evidencia; verify testing PASS |
| APPROVED_FOR_PRODUCTION | release independiente | todos anteriores PASS, source/versión/release notes/constitución/prebuild+promote; verify production PASS |
| RELEASING | ejecutor release distinto del aprobador | autorización producción con artefacto exacto, rollout/rollback/canario |
| RELEASED | orchestrator consolida ejecución | publicación real ambiente PRODUCTION y evidence, verify released PASS |
| BLOCKED | cualquier agente reporta/orchestrator registra | gate/entorno/artefacto discrepante, motivo y paso exacto, sin avanzar |

## Gates ejecutables y expediente

Copiar `.codex/templates/task-evidence.json` schema2 al área de tarea `.codex/reports/<taskId>/` o evidencia externa; sustituir placeholders por identidades/referencias reales. PENDING por defecto; gate requerido solo PASS, no N/A/NOT REQUIRED por falta de entorno. Opcional NOT REQUIRED lo deriva plan y lo confirma reviewer, nunca habilita etapa posterior.

Gates code: analysis, plan, review, qa y functional/regression/sync/offline/performance/device según selector/matriz. sync pertenece a sync-validator distinto reviewer/QA/performance/autores. Code schema1 admite verificación histórica exclusivamente code; jamás convierte informe viejo en aprobación interna/producción. Un gate ejecutado adicional fallido bloquea avance; no ocultarlo quitándolo del expediente.

`verify --stage code` = CODE_VALIDATED, sin aprobación de despliegue/producción. `internal` añade build e internalApproval; `deployment` añade internalDeployment; `testing` añade internalTesting; `production` añade productionApproval; `released` añade productionRelease. Todos acumulan antecedentes/SHA/artifacts/roles/independencia; false releaseEligible histórico impide que consumidores interpreten code como release. Los estados adicionales durante trabajo se registran por dueño; verify reconfirma puntos de aprobación, no es un daemon ni autentica identidades humanas.

Después de code se exige approvedArtifact completo application=CLIC-POS, packageName=com.clicpos.app, filename/localPath, versionName/code, commitSha, buildId/date, sizeBytes/sha256/certificateSha256 y buildType=release, instrumented/diagnostic/temporary=false. Manifest y todos los posteriores gates deben coincidir campo por campo; verifier lee bytes locales/size/hash. Firma/version/package/flags deben demostrarse por logs apksigner/aapt/build y aprobador build independiente: comparar hash no valida por sí solo esos metadatos. Se prohíbe elegir último archivo. artifact.localPath se resuelve relativo al expediente, no a cwd ambiguo.

QA ejecuta `qa --out /tmp/task-qa.log`; tests completados no son approval PASS. Reviewer y QA/sync/performance son distintos de los autores, build aprobador distinto orchestrator/deploy; internal testing no valida deploy propio; producción distinta build/deploy/testing; ejecutor producción distinto de su aprobador. Si fallan build/lint/tests requeridos se bloquea release, incluso preexistentes; instalación documental puede proponerse en draft con bloqueo registrado sin tocar POS.

JSON/sessionIds/archivos son declaraciones no firmas. Release/reviewer contrastan contenido/provenance de logs/sesiones/PR; verifier no puede autenticar ni probar flags hardware por manifest autodeclarado. Artifacts son archivos locales relativos al expediente, no directorios/URLs. --out siempre externo al repositorio, symlinks existentes/colgantes resueltos/rechazados para no sobrescribir código. Logs grandes externos con hash/enlace persistente en reportes; jamás secretos/PIN/tokens.

## Internal deploy y producción

Leer [contrato real Cloud-Admin](docs/architecture/CLOUD_ADMIN_DEPLOYMENT.md). Actualmente metadata landlord.pos_apk_releases + Supabase pos-apk-releases-api list/latest/create/update_status, URL binaria externa y estado internal_testing. No uploader/bucket APK/canal privado confirmado. Automatización upload completa = BLOCKED hasta proveedor/endpoint/permisos/canal y deploy real corroborados. No reutilizar helpdesk bucket ni inventar Vercel Blob. Esta solicitud instala procedimiento: NO deploy APK existente, NO producción, NO build APK.

Una vez completado contrato real, internal-deploy ejecuta IDENTIFY→VALIDATE→INSPECT_CURRENT→UPLOAD_NEW→VERIFY_STORAGE→PUBLISH_INTERNAL→VERIFY_DOWNLOAD→CLEANUP o RETAINED. Debe retener referencia/archivo anterior hasta nueva descarga verificada; cleanup solo política confirmada. Campos admitidos por metadata API se describen en mapa Cloud; commit/build/size/certificate permanecen expediente externo, no enviar campos inventados. create no idempotente: reconciliar list/ID/hash/version ante timeout antes de retry. Discrepancia o operación parcial aborta, reporta punto exacto y restaura referencia si soporte, sin declarar PASS. latest público muestra available; verificar interno por list/UI/registro y URL directa con checksum, no latest.

APPROVED_FOR_INTERNAL_TESTING autoriza solo ruta interna de tarea que ya tenga deployment solicitado/autorizado; no autoriza producción. Internal-deploy no aprueba build ni promueve available. Aprobación producción independiente exige internal testing, constitución APK golden prebuild/promote y evidencia real topologías/upgrade/metrics. No publicar/instalar fuera del alcance autorizado. Rollback referencia no garantiza downgrade dispositivo ni datos; no uninstall/clear.

## Comandos reales encontrados

Ejecutar desde raíz con Node 22 como CI. `npm ci` usa lockfile. Nunca usar db:reset, db:seed o scripts restore/reconcile sobre datos operativos como smoke.

| Uso | Comando existente / derivado de configuración | Límite |
|---|---|---|
| Desarrollo | `npm run dev` / `npm run dev:web` | Vite puerto 3000; proxy API local 3001 |
| Typecheck | `npx tsc -b` | No hay script typecheck; es primer paso real de build, incluye TS/TSX del repo |
| Build | `npm run build` / `npm run build:web` | tsc -b + vite; ambiente web separado |
| Lint | `npm run lint` | Script existe, falla sin eslint.config versionado; reportar BLOCKED/FAIL |
| Tests Node TypeScript | `./node_modules/.bin/tsx --test tests/*.test.ts` | Comando compatible con tests node:test, sin script test genérico; algunos contratos/hardware son limitados |
| Realtime MJS | `services/sync/PrivateRealtimeAuthorization.test.mjs` | Importa Vitest, no declarado en package.json; no hay runner funcional corroborado. Intento node --test falla por dependencia ausente, no presentarlo como comando operativo |
| Catálogo | `npm run test:catalog-sync` | Incluye runner integración automatic catalog saves; no sustituye ERP real |
| Setup Kotlin JVM | `bash scripts/qa/test-master-setup-jvm.sh` | Revisar prerequisitos JDK/Kotlin del script; no demuestra WebView hardware |
| Gate APK prebuild | `npm run qa:release-gate -- --source-commit HEAD --require-clean --report /tmp/release-gate-report.json` | Golden baseline qa/baselines/apk-1.1.363.json + required tests; no --skip-tests |
| APK assets/sync | `npm run android:sync` | Build + cap sync; modifica assets generados, usar worktree adecuada |
| APK debug | `npm run android:apk:debug` | Gradle assembleDebug después de sync |
| APK firmado | `npm run android:release:protocol` / `./scripts/release-android.sh <git-ref>` | Primera vía canónica; release requiere source/gates/keystore/worktree correctos |
| APK assemble directo | `npm run android:apk:release` | Existe, pero no elude protocolo canónico ni gate firmado |
| Promote APK | `npm run qa:release-promote -- --evidence RUTA.json --report /tmp/promotion-report.json` | Evidencia runtime real bajo schema existente, firma/versión/topologías/budgets; distinto del expediente multiagente |
| Servidor local | `npm run server` | nodemon → tsx server/index.ts; abre DB local |
| KDS | `npm run kds` | python3 server/kds_service.py; prerequisitos externos |
| Captura temporal | `python3 scripts/diagnostics/capture.py start --serial SERIAL --out DIR` y `stop` | SELECTIVE vigente; requiere dispositivo/ADB/DevTools/marcadores; no activar profiler histórico |
| Plan automático nuevo | `node .codex/scripts/workflow-gate.mjs plan --base BASE_SHA --candidate SHA [--critical]` | Diff committed, base ancestro; no incluye cambios sin commit |
| QA suites nuevo | `node .codex/scripts/workflow-gate.mjs qa --base BASE_SHA --candidate HEAD --out /tmp/task-qa.log` | Ejecuta grupos activados, no firma PASS; necesita checkout limpio/candidate actual |
| Verificar expediente por etapa | `node .codex/scripts/workflow-gate.mjs verify --base BASE_SHA --candidate SHA --evidence RUTA.json --stage code` | Fail closed, sin publicar; artifacts relativos al expediente |
| Smoke tooling nuevo | `node --test .codex/scripts/workflow-gate.test.mjs` | Prueba activación, independencia, bloqueo/evidencia/SHA; no tests POS |

Las suites del selector conservan la base transversal anterior, no cobertura exhaustiva. Sales/payments/tables/tickets/Z/print/auth se ejecutan como grupos aunque sus gates se reporten bajo functional/QA; no inventar un gate individual PASS por el simple hecho de ejecutarlas. Cambios catálogo requieren además test:catalog-sync según matriz. Cualquier build/lint/test fallido bloquea release funcional; fallo preexistente se registra y se corrige en tarea aparte, sin editar POS durante esta instalación documental.

## Límites de automatización y adopción

El planificador/gate local es ejecutable y determinista. Sus salidas --out deben estar fuera del repositorio y se resuelven symlinks para evitar sobrescribir código. AGENTS obliga a invocarlo, pero no se instaló un hook que intercepte todas las ediciones ni se cambiaron branch protections remotas. CI APK existente verifica baseline/build; no comprueba aún la identidad/provenance de todos los agentes. La adopción administrativa recomendada es hacer obligatorio el expediente y los checks del PR; no atribuir a Markdown enforcement que no tiene. Auditoría anterior histórica en docs/architecture/AUDIT_VALIDATION.md; ampliación actual en .codex/reports/INSTALLATION_V2.md.
