# Independent QA — Z declarations

Evaluator: /root/qa_declarations (no code authored). Date: 2026-11-16.
ERP base e8682d8b / candidate 42b2084d5dfbb0d8c95b50b121400ccec129ee4e.
POS base 3813a3a1 / candidate 4e038f743713ccf416a01245fcd417f3f0564cf0.

Commands:
- ERP `npx vitest run server/services/posZReportBreakdowns.test.js server/services/posZReportEmailService.test.js server/services/posZReportEmailParity.test.js src/components/finance/PosZReportDetailModal.test.ts`: FAIL, 72/76 passed. `/tmp/z-qa-erp-tests-final.log`.
- POS `./node_modules/.bin/tsx --test tests/zReportEmailService.test.ts tests/zReportPaymentSummary.test.ts tests/zReportSyncRetry.test.ts tests/closePreparation.test.ts tests/printOutputControl.test.ts tests/printCopies.test.ts`: PASS 51/51. `/tmp/z-qa-pos-tests-final.log`.
- Direct pure `computeStatus` body extracted from actual service using node new Function and helpers: all seven status branches tested PASS (noncash negative, compensated noncash, zero, cash-only, sync-only, both, pending excluded). Additional three assertions pass for deeply frozen snapshot and same-name/distinct-ID card zero. This is not API integration.

Blocking finding ERP: `buildLegacyPaymentMethodBreakdown`, line 114, references undefined `lines`, other undeclared variables in newly inserted aggregate block. Four actual tests reproduce ReferenceError, breaking any old Z report using totalsByMethod. Returned to implementation. G4 FAIL until corrected and repeated.

POS tests cover saved zero, several CARD identities, changed/empty config, retired method/no sales, absence stays absent, request payload, retries and print contracts. No real mail/provider calls or DB writes.

SSR modal tests are React static-markup tests, not browser screenshot or authenticated end-to-end UI. Device, DB final integrity, offline/network transitions and real delivery are not tested here. Sync/performance/data/release require their separate evaluators. Await independent G3 before final QA issuance.

## Corrected final candidate

Independent G3 reviewer /root/review_z_diagnosis confirmed PASS on ERP 0376b1787bdb03ef019bc40c788483f5657cf4e6 and POS 4e038f743713ccf416a01245fcd417f3f0564cf0. Former ReferenceError corrected; prior FAIL invalidated.

- ERP final official runner `npm test -- server/services/posZReportBreakdowns.test.js server/services/posZReportEmailService.test.js server/services/posZReportEmailParity.test.js server/services/posZReportSummary.test.js src/components/finance/PosZReportDetailModal.test.ts`: exit 0, 80/80 PASS, 5 files. Disposable PG17 socket-only cluster owned by runner, no remote DB. `/tmp/z-qa-erp-tests-corrected.log`.
- POS final candidate same 51/51 PASS, exit0. `/tmp/z-qa-pos-tests-final.log`.
- Cross-repo contract `/tmp/z-qa-cross-contract.ts` via POS tsx: exit0. Actual POS buildZReportEmailContractReport -> actual ERP validateZReportEmailBody -> buildZReportHtml. Synthetic saved zero declaration with a removed CARD method absent in sales/current config is preserved, rendered expected100/declared0/difference-100, and input unchanged. No provider/network/API/DB.
- Repeated seven actual computeStatus source-body branch assertions on final ERP HEAD: exit0 PASS. This tests logic, not HTTP handler/auth/DB integration.

G4 automated functional/regression scope PASS after independent G3. Scenarios: saved noncash declarations, zero, absent, pending excluded, separate cards, double-CASH consolidation, unmatched historic declaration, legacy explicit aggregate only if unique, HTML values and escaping, status compensated differences, current config empty/changed, request auth retry contract, print output contracts.

G4 full authenticated browser/device/mail-delivery validation BLOCKED / not executed: no isolated logged-in browser/device fixture or test mailbox supplied. Do not infer release eligibility from automated PASS. No permission/storage/sync writer paths changed; their integration/data/performance adjudication belongs to independent evaluators. No functional files edited by QA.
