# Constitución técnica permanente CLIC-POS

Toda tarea REQUEST sigue WORKFLOW.md: ANALYSIS→PLAN aprobado→IMPLEMENTATION→CODE REVIEW→QA→SYNC VALIDATION/PERFORMANCE cuando apliquen→INTERNAL RELEASE GATE→INTERNAL DEPLOY→INTERNAL TESTING→PRODUCTION RELEASE. No saltar gates; fallido vuelve implementación/review/validación. El orchestrator coordina y no modifica código funcional. Developer solo IMPLEMENTATION COMPLETED; ningún agente aprueba trabajo propio.

Delegar los nueve roles `.codex/agents/*.md` en sesiones independientes: orchestrator, analyst, developer, reviewer, qa, performance, sync-validator, internal-deploy y release. TOML adyacentes registran roles en clientes compatibles; si no hay selección nativa, delegar instrucciones completas y registrar limitación. Un escritor por archivo; reviewer/QA/sync/performance distintos entre sí y de todos autores. Sin agente/evidencia/entorno requerido BLOCKED.

Arquitectura corroborada develop: index.html→index.tsx→bootstrap.tsx→App, React/Vite/TS, shell Capacitor Android. App mantiene config/user/cart/catalog/transactions/parkedTickets/mesas/Z y navegación; servicios DB/sync singletons y eventos DOM/socket. DB factory elige IndexedDB web (fallback localStorage) o CapacitorSQLite Android; servidor Express/LAN usa otra SQLite. Kotlin native-stubs se compila por Gradle. ERP externo usa API y Supabase hints privados/poll/heartbeat; durable Outbox/recovery son flags apagados por defecto, no asumir rollout. Leer SYSTEM_MAP/CRITICAL_FLOWS/DEPENDENCY_MAP/SYNC_ARCHITECTURE/OFFLINE_ARCHITECTURE/PERFORMANCE_ARCHITECTURE/RISK_AREAS y CLOUD_ADMIN_DEPLOYMENT bajo docs/architecture; verificar snapshot contra SHA actual.

Comandos reales: npm ci; npm run dev/dev:web; npm run lint (bloqueado si eslint.config ausente); npx tsc -b (incluido en npm run build/build:web); npm run test:catalog-sync; tsx --test tests/*.test.ts sin script test general; npm run qa:release-gate/qa:release-promote; npm run android:release:protocol como vía canónica. WORKFLOW tabla declara prerequisitos/bloqueos y scripts Android/server/KDS; no inventar scripts typecheck/test/versioning ni usar seed/reset como QA.

Ejecutar node .codex/scripts/workflow-gate.mjs plan antes de implementar y reconfirmar diff committed; clasifica LOW/MEDIUM/HIGH/CRITICAL. Flujos ventas/cobros/tickets/mesas/Z/offline/sync/Outbox/Inbox/DB/auth jamás LOW. Shared/config/rutas desconocidas activan cobertura conservadora; storage/identidad/batch/lease/retry/order/hints/realtime/poll/heartbeat/offline activan sync-validator independiente; Android/WebView requiere device. Checklists once bajo .codex/checklists y expedientes bajo .codex/reports. Gates código y APK/internal/production son distintos; usar verify --stage code|internal|deployment|testing|production|released.

Seguridad: cambios mínimos compatibles con POS local/ERP web; flag si riesgo; conservar IDs/ACK/leases/orden/scope/atomicidad según adaptador y política offline. Pruebas de restart/network/provider ambiguity/doble evento/mesas concurrentes/closed membership según impacto. No datos/cargos reales ni reset/clear/uninstall/downgrade operativos para QA. No eliminar pruebas/quitar funcionalidades/apagar sync ni ocultar fallos.

Performance: objetivo UI p95<=50ms, reportar baseline/candidate n/p50/p95/p99/max y capturas; medir input→visible/interactivo separado de commit/print/network. Legacy APK500ms sigue presupuesto distinto. No loaders/setTimeout arbitrarios/manipular métricas/ocultar componentes sin quitar trabajo. LongTasks>50ms/layout/getBoundingClientRect/storage/GC/React/mainthread/timers/WebView stalls requieren evidencia. Performance solo avanza con QA funcional.

Deploy interno: solo exacto APK aprobado (SHA/filename/version/code/build/date/size/hash/cert/package/release limpio). APPROVED_FOR_INTERNAL_TESTING no autoriza producción. Cloud-Admin registra URL externa metadata/internal_testing; uploader/bucket APK/canal privado no corroborados, automatización completa BLOCKED. Uploadnew→verifystorage→publishinternal→verifydownload→cleanold/retained, nunca delete primero. Internal-deploy no desarrolla/aprueba builds/promueve available. Producción requiere internal testing y gate release independiente. Esta instalación NO despliega APK existente ni genera producción.

Git: nueva feature/<modulo>-<tarea> o fix/<modulo>-<bug> desde origin/develop; hotfix urgencias, commits Conventional pequeños, validar/push/PR develop. Main prohibido push directo/merge directo. Preservar trabajo ajeno; principal sucio/conflictivo permite worktree aislada documentada. Revert merge fallido por rama/PR. Protocolos firmados y constitución APK abajo siguen obligatorios. Instrucciones/gate local no son protección remota ni firmas de identidad.

---

# CLIC-POS — contexto para agentes (Codex, Cursor)

## Functional freeze del piloto

**CLIC-POS 1.1.405 / build 1405 es el PILOT FUNCTIONAL BASELINE.** Antes de cualquier cambio posterior, leer y cumplir [docs/PILOT_FUNCTIONAL_FREEZE_1.1.405.md](./docs/PILOT_FUNCTIONAL_FREEZE_1.1.405.md).

Priorizar observación. Solo modificar ante bug reproducible, fallo operativo, riesgo de integridad demostrado, regresión, requisito necesario de producción o solicitud funcional explícita. Aplicar reproducir → medir → causa → alcance mínimo → fix → regresión → antes/después. No hacer refactors ni optimizaciones especulativas; proteger los caminos validados y completar los campos obligatorios del reporte/PR. El indicador legacy ERP se corrige únicamente en su proyección visual; no reenviar SALE/PAY ni modificar Inbox/Outbox para corregirlo. CPU Cliente permanece KNOWN ISSUE / PENDING OPTIMIZATION sin impacto demostrado. No realizar downgrade automático de datos/esquema.

## Qué es este repo

Frontend POS (Vite/React) con shell Android vía Capacitor; SQLite nativo en APK.

## Fuente de verdad y rutas operativas

Para evitar releases incompletos, usa siempre esta jerarquía:

1. **`develop` es la única fuente oficial** del código que puede llegar a un APK release.
2. **Worktrees de runtime/laboratorio** (por ejemplo Polaris) sirven para validar y depurar, pero **ningún fix debe vivir solo ahí**.
3. **La worktree firmada** sirve para compilar el APK release. No se usa para desarrollar features ni para acumular fixes sueltos.

## Dónde trabajar (no confundir rutas)

| Objetivo | Ubicación |
|----------|-----------|
| Código, commits y PRs | **Repo principal** (este directorio). |
| APK **release firmado** (keystore) | **Worktree** `_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` en la misma máquina de build. |
| Runtime/laboratorio Polaris | **Worktree separada**; útil para pruebas, no para releases oficiales. |

Detalle operativo: [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md).
Protocolo de coordinación con agentes: [docs/AGENT_RELEASE_PROTOCOL.md](./docs/AGENT_RELEASE_PROTOCOL.md).
Constitución antirregresión obligatoria: [docs/APK_RELEASE_CONSTITUTION.md](./docs/APK_RELEASE_CONSTITUTION.md).

## Ramas

- Base habitual: **`develop`**. Las ramas **`feature/<modulo>-<tarea>`** y **`fix/<modulo>-<bug>`** son para PRs; **`hotfix/*`** se reserva para urgencias.
- **Git no permite** tener la **misma** rama checked out en dos sitios a la vez. Si el worktree firmado usa otra rama que el principal, es normal: alinea código con merge, cherry-pick o **rsync de archivos** según el checklist antes de `assembleRelease`.
- Antes de un release: confirma que el worktree tiene el mismo código que la rama que vas a integrar (revisa diff frente a `origin`).

## Versión Android

En `android/app/build.gradle`, **`versionCode`** debe subir en cada subida a Play (monotónico). Después de un release firmado, mantén **alineados** `versionCode` / `versionName` en el repo principal y en el worktree firmado.

## Lecturas útiles

- [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md) — flujo build + firma + verificación.
- [docs/AGENT_RELEASE_PROTOCOL.md](./docs/AGENT_RELEASE_PROTOCOL.md) — protocolo para Codex, Cursor y AG; evita mezclar fixes entre ramas, runtime y APK.
- [docs/APK_RELEASE_CONSTITUTION.md](./docs/APK_RELEASE_CONSTITUTION.md) — baseline 1.1.363, puertas prebuild/promote y presupuestos que bloquean regresiones.
- [docs/ANDROID_APK_SQLITE.md](./docs/ANDROID_APK_SQLITE.md) — notas SQLite / APK (si aplica a tu tarea).
