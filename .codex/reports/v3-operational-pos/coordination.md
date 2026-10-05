# V3 operational POS — coordination

Task owner/session: `/root` (orchestrator, no functional code writes).
Request: continue after #820 merge, integrate Large Master Sync V3 into the
existing complete POS cycle on the same Duarte_01 demo emulator. V2 production
remains unchanged; no promotion, unlink, reset, uninstall or credential rotation.

Base: `dc92365733b774203d282db23e6306ac05accb2f`, verified #820 MERGED with
`apk-release-gate` SUCCESS on 2026-10-05. Branch
`feature/sync-v3-operational-pos` starts at `origin/develop`.

Working checkout: `/Users/felixdiaz/.codex/worktrees/v3-canary-routing/CLIC-POS`.
Existing attached isolated worktree reused to preserve the principal checkout.
Canonical signed checkout is build-only, and presently has a modified
`android/app/build.gradle`; no build or overwrite authorized by these reports.

Role instructions are delegated to independent sessions because no native
client role selection is assumed. AGENTS.md mandates delegation. Sessions:

- Analyst: `/root/v3_operational_analysis`, analysis/plan only.
- Independent plan approver and code reviewer: `/root/v3_plan_review`, no code.
- Sole functional writer: `/root/v3_operational_developer`.
- QA, sync validator, performance, release and internal deploy: not yet run;
  their gates remain pending, never inferred from implementation or CI.

Preparation sessions subsequently delegated (their reports are preliminary,
not final candidate approvals): `/root/v3_operational_qa`,
`/root/v3_operational_sync`, `/root/v3_operational_performance`,
`/root/v3_operational_release`, `/root/v3_operational_internal_deploy`.
Independent live-code preflight: `/root/v3_operational_code_review`; exact-SHA
review is still pending.

To complete the already-approved artifact-safety amendment, ownership was
split by file after the runtime developer finished its focused refund substep.
`/root/v3_candidate_build_developer` owns only release script, Gradle candidate
mode declarations, promotion gate and artifact-safety tests. Runtime/financial
source files remain a separate writer assignment. Both identities are code
authors and cannot approve their own source/build. No two agents write the
same file. This is execution partitioning of the approved plan, not new
functional scope or an acceptance waiver.

Preimplementation `workflow-gate.mjs plan --critical` succeeded at the exact
base; external output `/tmp/v3-operational-pos-plan.json`. Risk CRITICAL.
Approved plan SHA-256:
`6ced0cbed8213123597076c850574917c9b52fe40896aa9e5b24ff5018399b9b`.
Independent decision in `plan-review.md`. Developer received explicit IMPLEMENT
authorization after that decision, for plan steps 1–8 only.

The first candidate is bounded to supported simple PRODUCT/SERVICE semantics.
This is an implementation step toward full V2 parity, not a reduced acceptance
target: advanced semantics and unrestricted inventory reconciliation remain
release blockers until contracted and independently validated. Missing ERP
causal inventory coverage requires keeping baseline plus local committed delta;
ACK alone must never clear the delta.

Read-only device snapshot: serial `127.0.0.1:6555`, emulator Pixel_C,
`com.clicpos.app`, versionName `1.1.480-canary`, versionCode `1480`. Existing
SQLite has V3 tables from older APK; its sessions do not yet contain
`contract_version`. No device data was modified. Native operational migration,
binding provenance and complete functional tests are still pending.

State: IMPLEMENTING. No claim of QA, performance, APK or release approval.

`/root/v3_financial_developer` completed the focused atomic financial substep
and released its files before receiving the separate UI integration assignment.
It is an author, not an independent approver. Its focused 19 tests and typecheck
passed; the broader suite had dependency ABI and catalog mock failures and is
not approved. The orchestrator ran `npm ci` with Node 22.23.3 successfully to
restore a consistent native test ABI. No audit autofix was applied (npm reported
60 dependency vulnerabilities). Full independent QA remains pending.

UI ownership now belongs exclusively to that same developer for App/POS/wrapper
and narrow UI regression helpers/tests. Financial/artifact source is frozen
during targeted independent pre-review by `/root/v3_operational_code_review`.
Agent slot limits prevented a new narrow developer session; continuing an
existing author does not satisfy or replace any independent approval role.

Orchestrator preliminary live-source diagnostics (not frozen-SHA QA): Node22
mandatory ten operational test files plus artifact-candidate tests: 58/58 pass;
V3 suite: 81/85 pass (four outdated support mocks); transversal workflow suite
including device tests: 284/285 pass (checkoutLatency literal product-read
assertion, actual protected helper must retain V2 behavior); lint exits 0 with
38 warnings. Review found held-operation refresh fences, source-field tamper
validation and incoming ERP authority-retention blockers; author is correcting
them before source freeze. No failure is waived or counted as gate approval.

## Explicit validation-artifact phase authorization

During this task the user answered: **“Sí, validar el candidato en Duarte_01”**
to a question authorizing one signed candidate after independent code review
and automated tests, before completing device/performance gates. This is a
narrow, explicit override of the circular gate ordering identified by the
independent performance/internal-deploy preparations. It does not weaken the
acceptance criteria or authorize production/release promotion.

The phase remains subject to independent plan-order review, frozen reviewed
source, automated QA/prebuild tests, canonical clean-source signing, explicit
operational candidate flags/suffix/nonpromotable metadata, independent artifact
inspection, and same-emulator `adb install -r`. Device/offline end-to-end and
performance gates stay pending until observed on that exact artifact. No false
CODE_VALIDATED/APPROVED_FOR_INTERNAL_TESTING declaration substitutes for those
pending gates. No APK has been built or installed during this task yet.

## Implementation partition completion

The separate UI author `/root/v3_ui_integration_developer` completed the
bounded UI/session integration and bootstrap read guards. Pre-review then
identified unmount cancellation, refund-only fiscal preservation, fiscal
provider deduplication and legacy empty-catalog auto-heal; that author owns
their correction exclusively. `/root/v3_financial_developer` completed the
native mutation reservation and retry-metadata retention correction with
80 focused tests passing and released all service files. Neither author
approves review, QA, sync, performance or artifacts.

Independent automated QA preparation by `/root/v3_automated_qa` awaits the
exact clean committed source and REVIEW PASS. Its 19 golden baseline files
remain required in addition to the skill's mandatory ten. Source changes are
being recorded in focused Conventional commits, not built as intermediate
APKs. Latest origin/develop inspected remains dc92365733b774203d282db23e6306ac05accb2f.

The UI correction author subsequently froze App/POS/queue/test changes with
16 focused tests and typecheck passing: lifecycle retirement after asynchronous
authorization, refund-only frozen persistence, V3 fiscal frozen input/reference
reuse/concurrent deduplication/ambiguous-attempt reconciliation, and candidate
legacy empty-catalog auto-heal suppression. Device/ERP behavior is unverified.
All implementation authors have released their files; final review and QA are
still pending and must bind the final committed clean source. Reports here are
preparation/author evidence, not acceptance approvals.
