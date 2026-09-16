# Procedimiento multiagente obligatorio CLIC-POS

Para toda tarea sigue [WORKFLOW.md](WORKFLOW.md): ANÁLISIS → PLAN aprobado → IMPLEMENTACIÓN → REVIEW independiente → QA → PERFORMANCE cuando aplique → RELEASE. Lee los mapas en docs/architecture y verifica diferencias contra la base actual.

El coordinador debe delegar analyst, developer, reviewer, qa, performance y release en sesiones con identidades registradas y responsabilidades de .codex/agents/*.md. Delega trabajos independientes en paralelo solo después del plan; limita a un escritor por archivo y conserva orden de gates. Reviewer/QA pueden trabajar en paralelo sobre un candidato congelado; release espera todas las evidencias. Ningún agente aprueba su trabajo; author y validator deben ser distintos. Si no hay agentes disponibles, detener aprobación/release y registrar BLOCKED, sin autoaprobar.

Ejecuta .codex/scripts/workflow-gate.mjs plan antes de implementar: activa suites por rutas y dependencias conservadoras. Flujos críticos ventas/cobros/tickets/mesas/Z/impresión/offline/sync/Outbox/Inbox/auth activan sus pruebas incluso por impacto indirecto; analyst/reviewer/QA amplían la matriz. Un gate fallido vuelve a implementación; cada nuevo SHA invalida aprobaciones anteriores. Objetivo respuesta interactiva p95 <=50 ms; performance exige evidencia cuantitativa y QA funcional.

Git obligatorio: rama nueva desde origin/develop, feature/<modulo>-<tarea> o fix/<modulo>-<bug>; hotfix solo urgencias. Commits Conventional pequeños; validar, push y PR a develop. Main estable: prohibido push directo y merge directo. No cambiar código ajeno ni resolver conflictos de otra tarea. Si principal está sucio/conflictivo, usar worktree aislada desde develop y reportar la excepción de ubicación.

Prioridad: ERP web conectado sin romper POS local. Cambios mínimos compatibles; flag si riesgo. No loaders/timers arbitrarios, quitar funcionalidades o apagar sync para ocultar rendimiento. Scripts destructivos no son QA. Nunca editar evidencia/baseline para conseguir PASS.

Los Markdown definen contratos humanos; los TOML adyacentes registran roles en clientes compatibles. No son procesos residentes ni fronteras de seguridad; no cambian configuración global o protección de ramas. Detalles de carga/fallback y gates ejecutables en WORKFLOW.md.

---

# CLIC-POS — contexto para agentes (Codex, Cursor)

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
