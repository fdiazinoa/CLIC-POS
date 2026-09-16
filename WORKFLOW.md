# Workflow multiagente CLIC-POS

## Uso obligatorio y alcance

Toda feature, fix, optimización o refactor sigue ANÁLISIS → PLAN → IMPLEMENTACIÓN → CODE REVIEW → QA → PERFORMANCE si aplica → RELEASE. Una tarea documental también necesita revisión y QA del procedimiento; no exige generar APK ni simular ventas. Esta instalación no modifica código funcional POS, activa flags de producción ni publica release.

El coordinador lee AGENTS y los mapas, congela base de develop y delega roles de `.codex/agents/`. Ningún agente aprueba su propio trabajo. Solo developer cambia código funcional; reviewer/QA/performance son sesiones distintas y no autores del candidato. Un solo escritor por archivo; tareas paralelas con contratos acotados y checkouts aislados cuando sea necesario. La ausencia de capacidad multiagente es BLOCKED para aprobación, nunca permite autoaprobar.

## Agentes permanentes y carga

Los seis Markdown solicitados definen responsabilidad y formato de entrega. Los seis TOML adyacentes incluyen name/description/developer_instructions para registro automático en clientes compatibles, sin fijar modelo ni cambiar configuración global. Es el formato contrastado con la [documentación oficial de subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents) el 2026-09-16. El cliente puede requerir confiar el proyecto/abrir sesión nueva; no se verificó carga nativa de estos roles en todas las versiones.

Si la herramienta solo admite task_name/message, el coordinador lee el Markdown y delega sus instrucciones completas a una sesión independiente; registra rol y sessionId devuelto. Un archivo MD por sí solo no registra un proceso residente, ni un TOML garantiza acceso a hardware o el cumplimiento de permisos heredados. No declarar que se invocó un rol nativo sin evidencia del cliente.

## Expediente y estados

Guardar por tarea en `docs/workflow/tasks/<taskId>/` los artefactos revisables o en almacenamiento de evidencias externo sin secretos/datos de clientes. Copiar `.codex/templates/task-evidence.json`; reemplazar IDs por identidades de sesión reales. El verifier resuelve artifacts relativos al directorio del expediente. Cada gate declara candidateSha completo, rol, agentId y rutas de evidencias locales; PENDING por defecto. Conservar logs/capturas brutas y referencia a PR/base/ambiente.

- ANALYSIS: mapa del problema, evidencia, riesgos, consumidores, APIs/eventos/almacén, plan propuesto y criterios.
- PLAN: alcance aprobado, base SHA, suites/scenarios/performance boundaries y rollback; aprobador independiente del analista. Un reviewer o usuario puede aprobar el plan con identidad distinta. Cambios materiales de plan requieren nueva aprobación.
- IMPLEMENTED: diff y comandos del developer; esto no es PASS funcional.
- PASS: validador independiente demostró el contrato con evidencia para SHA exacto.
- FAIL: contrato incumplido; vuelve a implementación y repite todos los gates afectados sobre nuevo candidato.
- BLOCKED: falta hardware/ERP/credenciales/capturas/herramienta; impide release.
- N/A: solo para gate opcional no requerido con justificación independiente de ausencia de impacto; un gate requerido jamás admite N/A.

Todo nuevo candidate SHA invalida los PASS anteriores. La aprobación inicial del plan puede ocurrir antes del commit candidato; después analysis/plan se reconfirman para el candidato, referenciando el plan aprobado original. Registrar todos los autores, también de documentación/tooling, para evitar aprobación propia. IDs y JSON no son firmas criptográficas: reviewer/release comprueban provenance en sesiones/PR y contenido de artefactos; el script no autentica declaraciones humanas.

## Secuencia por tarea

1. Inspeccionar estado/worktrees y preservar trabajo ajeno. `git fetch origin develop`, congelar `BASE=$(git rev-parse origin/develop)` (usar variable propia, no HOME). Crear `feature/<modulo>-<tarea>` o `fix/<modulo>-<bug>` desde esa base; hotfix solo urgencia. Principal para desarrollo; si tiene conflictos/cambios ajenos, worktree aislada desde develop y explicar excepción.
2. Analyst inspecciona fuente completa relevante y dependencias. Lee SYSTEM_MAP, CRITICAL_FLOWS, DEPENDENCY_MAP, RISK_AREAS; los mapas son snapshot y necesitan corroboración.
3. Preparar diagnóstico/plan, matriz transitiva, criterios y escenario baseline. Antes de implementar, llamar planificador con `--critical` y base=candidate=BASE para selección preventiva si habrá cambio funcional. El selector de diff requiere candidato committed; el análisis preventivo complementa esa restricción.
4. Aprobar el plan independientemente y registrar quién/qué/base. Esta solicitud ya autoriza instalar el procedimiento; decisiones rutinarias dentro del alcance no exigen volver a pedir permiso.
5. Developer implementa mínimo y confirma commits Conventional. Ejecuta checks técnicos y reporta resultados; no firma validación. Congelar candidate SHA.
6. `node .codex/scripts/workflow-gate.mjs plan --base "$BASE" --candidate HEAD --out /tmp/task-plan.json`. Activación automática conservadora: cualquier cambio fuera de docs/AGENTS/WORKFLOW/.codex activa functional/regression/sync/offline/performance y grupos venta/mesas/Z/print/auth; ante impacto indirecto, `--critical`. Analyst/reviewer/QA pueden añadir gates, nunca reducir automáticamente los requeridos.
7. Reviewer independiente revisa diff/callers, alcance, carreras/estado/efectos/idempotencia y matriz. QA distinto ejecuta suites seleccionadas y E2E/checklists pertinentes. Sobre candidato congelado pueden trabajar en paralelo; todos devuelven evidencia ligada a SHA.
8. Performance independiente mide baseline/candidate si requerido; incluye QA funcional, métricas y capturas sin manipulación. Objetivo p95 <=50 ms para respuesta interactiva con boundary definido, umbrales/deltas y límites en checklist performance. No se aprueba por tests de texto ni por passing build.
9. Completar expediente. `node .codex/scripts/workflow-gate.mjs verify --base "$BASE" --candidate HEAD --evidence RUTA/task-evidence.json`. Bloquea SHA obsoleto, falta de artifacts/PASS, roles incorrectos, autoaprobación y falta de gates. El PASS indica elegibilidad documental, no un APK publicado: release verifica adicionalmente contenido/provenance y gates de artefacto/plataforma.
10. Push rama y abrir PR hacia develop con diagnóstico/cambio, pruebas, riesgos, SHA y gates. FAIL/BLOCKED deja PR draft/no merge y devuelve tarea a implementación. No push directo main ni merge directo main. Para merge fallido, revert del merge commit mediante rama/PR urgente conforme política; jamás tocar main directamente.
11. Solo para release solicitado, agente release independiente aplica checklist, docs/APK_RELEASE_CONSTITUTION.md y protocolo canónico. APK: golden prebuild, source exacta, signed worktree limpia/alineada, versiones formalizadas/monotónicas, build/firma/hash, upgrade preservando datos y runtime promote. Main sigue reservado a promoción controlada según política de proyecto.

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
| Verificar expediente nuevo | `node .codex/scripts/workflow-gate.mjs verify --base BASE_SHA --candidate SHA --evidence RUTA.json` | Fail closed, sin publicar; artifacts relativos al expediente |
| Smoke tooling nuevo | `node --test .codex/scripts/workflow-gate.test.mjs` | Prueba activación, independencia, bloqueo/evidencia/SHA; no tests POS |

Las suites del selector son una base transversal, no cobertura exhaustiva. Tickets/Z/print/auth se ejecutan como grupos aunque sus gates se reporten bajo functional/QA; no inventar un gate individual PASS por el simple hecho de ejecutarlas. Cambios catálogo requieren además test:catalog-sync según matriz. Cualquier build/lint/test fallido bloquea release funcional; fallo preexistente se registra y se corrige en tarea aparte, sin editar POS durante esta instalación documental.

## Límites de automatización y adopción

El planificador/gate local es ejecutable y determinista. Sus salidas --out deben estar fuera del repositorio y se resuelven symlinks para evitar sobrescribir código. AGENTS obliga a invocarlo, pero no se instaló un hook que intercepte todas las ediciones ni se cambiaron branch protections remotas. CI APK existente verifica baseline/build; no comprueba aún la identidad/provenance de todos los agentes. La adopción administrativa recomendada es hacer obligatorio el expediente y los checks del PR; no atribuir a Markdown enforcement que no tiene. Resultados concretos de esta instalación en docs/architecture/AUDIT_VALIDATION.md.
