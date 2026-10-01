# CLIC-POS agent constitution

This file contains mandatory repository rules. Detailed architecture and procedures live in linked documents so this constitution stays short.

## Source of truth and Git

- `main` is the base, integration, and production source of truth. Do not use `develop` unless the user explicitly requests it.
- Start every task from an updated `origin/main` in a new `feature/*`, `fix/*`, or urgent `hotfix/*` branch.
- Keep changes minimal, validate them, push the task branch, and open a PR to `main`. Never push directly to `main` without explicit instruction.
- Use small Conventional Commits such as `feat(erp): ...`, `fix(sync): ...`, `refactor(pos): ...`, or `chore(ci): ...`.
- Preserve unrelated local changes. Never develop inside the signed-build worktree or a runtime laboratory checkout.

## Harness contract

- Every request becomes a task under the process in [WORKFLOW.md](WORKFLOW.md).
- Run the risk engine against every affected path. Required gates may be added, never silently removed.
- No agent may approve its own implementation. `DEVELOPER` cannot declare QA, review, sync, offline, performance, build, or release `PASS`.
- A gate records only `PASS`, `FAIL`, `NOT_REQUIRED`, or `BLOCKED`, always with evidence.
- Never alter, hide, or delete evidence to obtain a pass. Never disable tests to obtain a pass.
- Stop automatic retries after the configured limit and mark the task `BLOCKED` with the last valid state and evidence.

Commands:

```bash
npm ci
npm run harness:test
npm run harness -- assess --files <comma-separated-paths>
npm run build
```

`npm run lint` is not a valid gate until an ESLint 9 configuration is added and verified. POS functional, sync/offline, performance, device and deployment gates are `BLOCKED` when their required environment or runner is unavailable.

## Critical runtime rules

- Android uses Capacitor SQLite; web uses IndexedDB. Do not assume the localStorage adapters are canonical.
- Sales, payments, fiscal totals, tickets, tables, Z close, print, SQLite, offline queues, sync, auth and Android bridges are high-risk areas.
- Validate offline operation across restart and reconnect. Validate business-level idempotency, ordering, retries and crash boundaries for sync.
- Compare performance baseline and candidate on the same device/scenario. Report p50, p95, p99, max, and long tasks over 50 ms. An average improvement never hides a p95/p99 regression.
- Do not build an APK until required gates pass. Never select an artifact because it is merely the newest file.
- Associate an APK with task, commit, `versionName`, monotonic `versionCode`, test results, signature verification and SHA-256.
- Internal deployment is not production. Production always requires explicit human approval.

## Security and destructive operations

- Never print or store secrets in logs/evidence, commit credentials, or copy production PII into fixtures.
- Existing tracked sensitive-looking files are a documented inherited risk; rotation/removal/history cleanup require a separate human-controlled task.
- Release signing, Cloud-Admin publication, production promotion, deleting a published APK, database reset/restore, and evidence cleanup require explicit human authorization and validated targets.
- Prefer upload-new → verify → publish → verify download → retire-old. Preserve a rollback pointer/version during internal deployment.

## Required reading by scope

- Architecture and dependencies: [SYSTEM_MAP](docs/architecture/SYSTEM_MAP.md), [DEPENDENCY_MAP](docs/architecture/DEPENDENCY_MAP.md)
- Sales/tables/offline critical paths: [CRITICAL_FLOWS](docs/architecture/CRITICAL_FLOWS.md)
- Sync: [SYNC_ARCHITECTURE](docs/architecture/SYNC_ARCHITECTURE.md)
- Offline/storage: [OFFLINE_ARCHITECTURE](docs/architecture/OFFLINE_ARCHITECTURE.md)
- Performance: [PERFORMANCE_ARCHITECTURE](docs/architecture/PERFORMANCE_ARCHITECTURE.md)
- Known risks: [RISK_AREAS](docs/architecture/RISK_AREAS.md)
- APK and internal deployment: [APK_AND_INTERNAL_DEPLOY](docs/release/APK_AND_INTERNAL_DEPLOY.md)
- Existing native details: [ANDROID_APK_SQLITE](docs/ANDROID_APK_SQLITE.md), [NATIVE_PRINT_BRIDGE_CONTRACT](docs/NATIVE_PRINT_BRIDGE_CONTRACT.md)

