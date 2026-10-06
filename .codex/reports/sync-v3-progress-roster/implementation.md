# IMPLEMENTATION COMPLETED — V3 progress only

Task `sync-v3-progress-roster`, delegated developer session `/root/v3_setup_fix_developer`, 2026-10-05. Base `ac947f2baec1af8810a3422c1cdf64fc4ccd44df`; branch `fix/sync-v3-progress-roster`. Independent analyst/reviewer plan: `/private/tmp/clicpos-v3-progress-roster.qHV0qw/analysis-plan.md`, SHA256 `96123b1f8070aaebe5562a30ae46825e731cd0e3ed87911e1511b5d900b73351`; approved review SHA256 `303c7c545ba2471c06323687ade9ebe7abf291bfc08edb37d09a57ccec44ef33`. Developer does not approve its own implementation or release.

## Implemented boundary

Client publishes global catalogue totals and confirmed persisted counts from manifest/existing `readProgress` results, including baseline, ACTIVE/VALIDATED resume and zero chunks. Dataset/validation/activation phases retain existing request, persistence and readiness behavior. Counting is O(declared datasets), not product rows; downloaded/retried/duplicate chunks do not increment UI counters. No new SQL/progress/database-size reads, network calls, timers, row materialization or preparation generation.

Candidate and OperationalSession forward inventory download/save/readback/runtime/owner phases. Shared coordinator retains single-flight/cache verification/explicit refresh; a bounded observable isolates thrown observers, supports late replay/unsubscribe, and fences generation, local binding scope and sync ID/version. Scope comparison reads existing local binding identity on coordinator calls only; no credentials/identity/PIN values appear in progress snapshots. Cached verified sessions are labelled as existing catalogue, not simulated download.

The small `LargeMasterSyncV3SetupProgress` subtree owns the React subscription, with accessible progressbar, catalogue-labelled counts/integer percentage, and indeterminate subsequent phases. At most 101 numeric percent bucket publications per generation plus phase/dataset/error transitions; exact latest counts retained in one snapshot. App subscribes before initialize for pairing, owns one attempt descriptor (no chunk state updates), closes observers on completion/error/retry/unmount, and keeps a failed phase visible until returning to pairing. Startup ERP loader uses the same shared observable. Catalogue100 is not setup-ready; `ready` is published only at App's existing finish boundary after current owner/catalogue/inventory/config and existing security processing. Flag-OFF/LAN/local/client paths retain the existing UI/behavior.

No roster/auth/PIN/permissions/filter/seed changes. Independent diagnosis of empty authoritative roster is separate; this implementation does not claim to repair cashiers or authorize fallback users.

## Developer technical checks (not independent gates)

Node22; initial candidate checks preserved in external dossier `/private/tmp/clicpos-v3-progress-roster.qHV0qw`:

- `developer-checks-final.log`: 164 tests PASS, 0 failures, 0 skipped; full V3 tests plus executable React component/coordinator fixtures, startup security/role/user policy regressions. Lint: 0 errors, 38 warnings. Log SHA256 `ea18c42b9b163ce7d24948f8d6cf306860185332425bbe997692866e6f2c2d58`.
- `developer-build-both-final.log`: both web builds pass (`tsc -b && vite build`), candidate OFF and candidate ON / canary OFF / explicit Railway download origin. Existing bundle-size warnings retained. SHA256 `161755e61db7a45eeb29da6863a3d0ee9a041ca20ef34c80b0350c9dfc34ae36`.
- Earlier focused logs preserved (`developer-targeted*.log`, initial V2/V3 build and regression logs), plus developer preventive CRITICAL gate `developer-preimplementation-plan.json`.
- Executable SQLite receiver fixture: persisted3/declared10 baseline=30%, global resume/duplicate counts, observer absent/present identical SQL query and network counts, zero-chunk/throwing observer success. Candidate fixture likewise identical operation counts. Coordinator/component fixtures cover catalogue100→indeterminate inventory failure, no false finish, late replay, cleanup, reentrancy, binding/foreign sync/generation fences and one prep across callers. React server-rendered actual component fixtures are host evidence, not physical mounted-device or latency certification.

## Pending independent validation

Independent code review, QA/workflow/catalogue, sync/offline and device/performance gates remain pending. No performance PASS/p95 claim, APK generation/install, Gradle/Capacitor sync, Android version change, operational DB/ERP writes, push or PR was performed by this developer task. Canonical signed worktree and principal user changes were left untouched. Rollback is candidate flag OFF or focused commit revert through authorized workflow; no data reset or downgrade.

## Independent review repair

Independent `code-review-08a85f7.md` rejected candidate `08a85f745e30ba2c6460ee65c35cbad84265601c` for one P2: explicit refresh captured the old reporter before deferred preparation created its generation, losing final verified/failure updates. That failed review and original logs are preserved; this report does not supersede the reviewer decision with self-approval.

The repair retains the refresh outer shared flight while verifying the previous cache, reserves it before reentrant callbacks, and resolves completion/failure reporter after that actual awaited flight has begun its generation. Updates cannot borrow a newer flight or a different binding scope. No additional preparations, store/network/progress reads, timers, retries or authorization changes. Executable fixture covers cached get → healthy/refreshed assertCurrent rejection, concurrent two refresh/one ordinary caller, correct latest verified/failed state, two opens total and five existing assertions in both cases.

Post-repair Node22 developer checks: `developer-refresh-repair-targeted.log` 12 PASS/0 skipped; `developer-refresh-repair-checks-final.log` 165 PASS/0 failed/0 skipped, lint 0 errors/38 warnings, SHA256 `ba665c4db7d31cb28519054d9662d580e023209e0196219bcd62cbd201470a39`. Both web builds PASS in `developer-refresh-repair-builds-final.log`, SHA256 `8b076cfc00f97387e23cc20d869ee2cce4688296d03ad628471d7daf88334db2`, preserving candidate OFF and candidate ON/canary OFF/explicit Railway flags. All independent gates remain pending for the newly frozen repair commit.

## Independent performance cleanup repair

Independent `performance-a9ce65b.md` rejected the cleanup contract of candidate `a9ce65b465f1719a7c878f955092c7aa4af00870`: the copied listener iteration could call B after A had unsubscribed B during the same publication. Preserved reproduction `performance-cleanup-a9ce65b.log` (SHA256 `b06af2058713f83086bedccda21d37514a97062e6448a999bffe4eb68a1c9739`) observed1/expected0, exit1. Existing independent host QA/sync did not certify this missing edge case or Android/global performance.

Minimal repair uses unique active subscription registrations. Every copied registration is checked immediately before notification; unsubscribe deactivates exactly that registration. Reusing the same callback creates a new registration with its own immediate replay and cannot resurrect the removed registration. Copied-iteration reentrancy and observer exception isolation remain; no polling, network/SQL/storage/preparation work is added. Actual helper/coordinator/component-render fixtures cover A removing B within the same publication (zero calls after stop), removal/resubscription of the same callback (one immediate new replay, no old-registration call), subsequent notifications and final cleanup, retaining existing preparation/assert counts. Mounted-device and latency evidence remain separate and pending.

Post-cleanup-repair Node22 developer evidence: `developer-cleanup-repair-targeted.log` 14 PASS/0 skipped; `developer-cleanup-repair-checks-final.log` 167 PASS/0 failed/0 skipped, lint0 errors/38 warnings, SHA256 `57560d4430cff790308accee346d3436ff0288539e1038f7689b220cb747618f`. Both candidate OFF/ON web builds PASS in `developer-cleanup-repair-builds-final.log`, SHA256 `bebf8d2f41689cfb1957422518a65a70586fafeea3c2ab91b0e4953ac2f2df71`. Failed performance report/logs and all preceding evidence preserved. This changed candidate requires new independent review/QA/sync/performance; no self-approval or global runtime/performance certification is asserted.
