# CLIC-POS development workflow

## Invariant

No agent may approve its own work. The orchestrator assigns work and advances state; it does not turn an implementer's assertion into a pass. Machine output is preferred over prose, and manual evidence must identify scenario, actor, environment and result.

## Task lifecycle

```text
NEW → ANALYZING → PLAN_READY → IMPLEMENTING → REVIEWING
  REVIEW FAIL → REVIEW_FAILED → IMPLEMENTING
  REVIEW PASS → QA
  QA FAIL → QA_FAILED → IMPLEMENTING
  QA PASS → SYNC_VALIDATION? → OFFLINE_VALIDATION? → PERFORMANCE?
  non-release task, all required gates complete → COMPLETED
  required gate FAIL → matching *_FAILED → IMPLEMENTING
  gates complete → READY_FOR_INTERNAL_RELEASE → BUILDING
  BUILD PASS → APPROVED_FOR_INTERNAL_TESTING
  authorized internal deploy → DEPLOYING_INTERNAL → INTERNAL_TESTING
  human testing pass → INTERNAL_TESTING_PASSED
  independent human approval → APPROVED_FOR_PRODUCTION → RELEASED
```

Any state may move to `BLOCKED` when prerequisites are missing, a safety condition cannot be verified, or the retry limit is exhausted. Resume only from a recorded valid state with the blocking condition resolved.

## Required artifacts by phase

| Phase | Owner | Required output |
|---|---|---|
| Analysis | ANALYST | requirement/symptom, code evidence, root cause or design basis, files, dependencies, risk, plan, validation |
| Implementation | DEVELOPER | minimal diff, commit SHA, changed-file list, local checks; never a QA approval |
| Review | REVIEWER | independent findings and `REVIEW_GATE` evidence |
| QA | QA | executable results for affected behavior and regression matrix |
| Sync | SYNC_VALIDATOR | event ids/states for online, reconnect, ordering, duplicate, retry and recovery scenarios |
| Offline | OFFLINE_VALIDATOR | local state before/after restart and reconnect |
| Performance | PERFORMANCE | comparable raw samples plus p50/p95/p99/max and long tasks |
| Build | RELEASE/QA | exact commit, command, logs and artifact metadata |
| Internal deploy | INTERNAL_DEPLOY | storage id, publication pointer, downloaded checksum and rollback pointer |

## Risk and gates

Run `npm run harness -- assess --files ...`. The machine-readable matrix is `dev-harness/config/clic-pos.json`.

- `LOW`: isolated harness/docs work; build, independent review and QA of the harness/docs.
- `MEDIUM`: ordinary UI/API/config changes; build, review, QA, plus performance when rendering can change.
- `HIGH`: sales, payments, tickets, tables, Z, printing, storage, offline, sync, auth and Android; all applicable domain gates.
- `CRITICAL`: signing, release, deployment, destructive migration or production control; full gate set and human authorization.

`NOT_REQUIRED` is a result, not an omission. Its evidence must state why the affected architecture cannot reach that domain.

## Gate execution and retries

1. Record command/environment/scenario before execution.
2. Capture stdout/stderr, exit code, versions, commit and relevant artifact ids without secrets.
3. Record exactly one of the four gate results.
4. On failure, retain evidence, return to the developer with the failure record, then repeat review and every invalidated downstream gate.
5. Maximum automatic retries: two. A third need marks the task `BLOCKED` and produces a human triage report.

The orchestrator assigns named actors to roles. After implementation, the developer commits the candidate and `seal-candidate` records the clean commit before the task can enter `REVIEWING`. Returning to `IMPLEMENTING` invalidates all prior gate results while preserving their evidence/history. Concurrent updates use locks plus revision checks; a stale writer must reload rather than overwrite another agent's state.

## Release gate

`APPROVED_FOR_INTERNAL_TESTING` requires `PASS` or justified `NOT_REQUIRED` for optional domain gates and strict `PASS` for review, QA, build and internal release. The APK record must bind task, sealed candidate commit, version, checksum, verified signature and test results. An unsigned, missing or ambiguously sourced artifact fails closed.

Internal testing never implies production approval. `APPROVED_FOR_PRODUCTION` is a separate human decision. See [docs/release/APK_AND_INTERNAL_DEPLOY.md](docs/release/APK_AND_INTERNAL_DEPLOY.md).

Tasks whose impact matrix does not require `INTERNAL_RELEASE_GATE` finish at `COMPLETED` after every required gate is satisfied. They do not traverse APK or deployment states.

## Human approval

Always required for production release, signing-material changes, first use/change of Cloud-Admin publication credentials or API, deleting/retiring a currently published APK, database reset/restore, destructive migrations, credential rotation/history rewrite and overriding a failed/blocked gate. Gate overrides do not convert evidence to `PASS`; they are separately logged policy decisions.
