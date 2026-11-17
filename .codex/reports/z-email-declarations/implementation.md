# Z email declaration snapshot — implementation

- Request: show each saved payment declaration in ERP/email without changing POS operation.
- Branch: fix/pos-z-email-declarations; target: develop.
- Base: 3813a3a16d48e9815e5840c1cd3d3483ffae358f.
- Author: /root/pos_email_fix (developer); state: IMPLEMENTATION COMPLETED, independent gates pending.
- Plan ratified by /root/review_z_diagnosis G0/G1 before code changes; coordinating task evidence: ERP docs/development/tasks/z-payment-declarations.md.
- Isolated worktree used because main POS checkout contains unrelated/conflicted work. No unrelated files changed.

## Scope

Only services/email/zReportEmailService.ts and its tests: preserve historical paymentMethodDeclarations values/identity independently of current terminal configuration or sales summary. Explicit zero stays zero; absent declaration stays absent. Cash and pending remain outside noncash declarations as before. Copy objects instead of mutating the persisted close. No capture, DB, sync transport, printing, Android or APK changes. No new external calls.

## Validation by developer (not independent approval)

- Preventive selector: `node .codex/scripts/workflow-gate.mjs plan --base 3813a3a1 --candidate 3813a3a1 --critical --out /tmp/z-email-plan.json`: exit 0, conservative CRITICAL; reconfirm committed candidate required.
- `npm ci --ignore-scripts --no-audit --no-fund`: exit 0; dependencies installed only in isolated worktree, lockfile unchanged.
- `./node_modules/.bin/tsx --test tests/zReportEmailService.test.ts tests/zReportPaymentSummary.test.ts tests/zReportSyncRetry.test.ts tests/closePreparation.test.ts tests/printOutputControl.test.ts tests/printCopies.test.ts`: exit 0, 51 tests passed. Includes 18 email tests, explicit-zero/multiple CARD identity/current config changed or empty/removed method/no-sales snapshot/no missing-to-zero/transport request body, retry and print contracts.
- `npm run lint`: 0 errors, 43 warnings; log `/tmp/z-email-lint.log` (temporary local artifact).
- `npm run build`: TypeScript + Vite completed, output ends `built in 5.12s`; existing chunk-size warnings; log `/tmp/z-email-build.log` (temporary local artifact).
- `git diff --check`: exit 0.

No real email sent, no DB writes, no device/APK/offline runtime validated. Required independent review/QA/sync/performance/release are pending; no deploy/production eligibility asserted. Rollback via revert PR, no data migration.
