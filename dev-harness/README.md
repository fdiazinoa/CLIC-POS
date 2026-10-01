# CLIC-POS Development Harness

This directory is the repository-local control plane for development tasks. It does not replace the POS runtime and it never treats an agent's prose as proof. A task is a JSON state record; every gate has one of `PASS`, `FAIL`, `NOT_REQUIRED`, or `BLOCKED` and points to evidence.

## Quick start

```bash
npm run harness:test
npm run harness -- assess --files services/sync/SyncManager.ts
npm run harness -- init --title "Short task title" --description "Requested outcome" --files services/sync/SyncManager.ts --actor orchestrator
npm run harness -- transition --task POS-2026-0001 --to ANALYZING --actor analyst-1
npm run harness -- assign-agent --task POS-2026-0001 --role DEVELOPER --actor developer-1 --assigned-by orchestrator
npm run harness -- implementer --task POS-2026-0001 --actor developer-1 --summary "Minimal implementation"
# Commit the candidate, make sure the worktree is clean, then:
npm run harness -- seal-candidate --task POS-2026-0001 --actor developer-1
npm run harness -- run-gate --task POS-2026-0001 --gate BUILD_GATE --actor qa-1 --role QA
```

Generated task state, evidence, reports, APKs and performance samples are ignored by Git by default. Attach them to the PR or approved evidence store; never commit credentials, personal data, operational database dumps, signing keys, tokens, or raw production payloads.

If discovery changes the affected-file set or fixes a false-positive classification, the assigned orchestrator may run `reassess` with an existing evidence file. The old and new risk/gate sets remain in task history; gates are never removed silently.

## Layout

- `config/clic-pos.json`: impact/risk matrix, gate order and authorized approver roles.
- `core/`: deterministic state, risk, gate, evidence and APK metadata functions.
- `bin/clic-harness.mjs`: dependency-free CLI.
- `agents/registry.json`: bounded role contracts.
- `capabilities/registry.json`: reusable operations and exact evidence/pass/fail contracts.
- `schemas/`: machine-readable task contract.
- `tasks/`, `evidence/`, `reports/`, `artifacts/`: runtime outputs, ignored by Git.
- `performance-baselines/`: ignored device/scenario baselines; publish them in the approved evidence store.

## Fail-closed rules

1. Unknown affected files are at least `MEDIUM` risk.
2. Sales, payments, tickets, tables, Z close, printing, persistence, auth, sync, offline and Android changes are never automatically `LOW`.
3. A `PASS` needs evidence and an authorized role.
4. The recorded implementer cannot approve any approval gate.
5. Agents must be assigned by the task's orchestrator; a clean candidate commit is sealed before review.
6. Missing, failed, or blocked required gates prevent internal release. Review, QA, build and internal-release gates require `PASS`; they cannot be waived as `NOT_REQUIRED`.
7. `NOT_REQUIRED` needs a documented justification and independent gate owner review.
8. Two automatic retries are the default; further failed attempts set the task to `BLOCKED` for human triage.
9. Production promotion is always human-controlled and is not implemented by this harness.

Non-release tasks finish at `COMPLETED` after their required gates. Only tasks that require `INTERNAL_RELEASE_GATE` enter the APK/internal-deployment lifecycle.

Executable gate evidence stores the commit, cleanliness checks, exit code, byte counts and SHA-256 of stdout/stderr. Raw command output is intentionally not persisted because it may contain secrets; attach only independently scrubbed logs when they are needed.

## Current capability limits

`main` has no automated POS functional test suite, performance collector, CI/CD pipeline, or Cloud-Admin upload contract. Those gates must remain `BLOCKED` until executable evidence exists. The harness tests validate only the harness itself. Android release and internal deployment capabilities are documented but were deliberately not executed during installation.

See [WORKFLOW.md](../WORKFLOW.md), [the system map](../docs/architecture/SYSTEM_MAP.md), and [the release pipeline](../docs/release/APK_AND_INTERNAL_DEPLOY.md).
