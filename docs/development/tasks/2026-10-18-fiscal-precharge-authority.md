# Fiscal issuer checks before payment

Role DEVELOPER `/root/precharge_developer`, independent sole POS functional writer. Status **IMPLEMENTATION COMPLETED**, pending independent code review, QA, sync, performance/device and release gates. Coordinator is not the functional author. Base `df8cfcbf33a21ffddb3994d0afa99bdbc75ae753` (`develop`), isolated worktree `/tmp/clic-pos-precharge`, branch `fix/fiscal-precharge-validation` preserves unrelated principal changes.

Plan: `/tmp/clic-commercial-fiscal-pos-analysis/plan.md`, SHA256 `113a78192aab15790f525085a964221b5912bc2bd579312f80849e9fa11891f0`, analyst `/root/integration_qa`. G0/G1 independent approval `/tmp/clic-commercial-fiscal-pos-review/g0-g1.md`, SHA256 `aca140ae8751a9f73eec7dbedd5124eb9959112121f60f20f38296f9a75db129`, reviewer `/root/tck39_release`. This records source evidence and role delegation, not a signed identity or downstream approval.

New electronic reservations now require the company's persisted RNC (9 or 11 digits, established separators only). One shared parser is used by snapshot creation and native receipt planning. Checkout reads fresh persisted authority at existing boundaries before opening payment, manual tender entry, finalization/fraction confirmation and each integrated authorization. Existing lot, terminal, scope, device, session, permit and buyer guards remain in place. No online requirement is added for otherwise valid local authority.

Both reservation entry points validate before their first possible buffer/allocation write. Native consumption requires a proven issuer for E* inside existing frozen-config CAS/transaction before receipt/counter writes. The existing reservation facade also correctly handles native config's singleton object as well as array results; treating the native object as an array previously silently created an issuer-null preliminary snapshot.

Kiosk's existing mandatory-fiscal draft rejection now runs before gateway effects. This does not add fiscal Kiosk issuance. Nonfiscal Kiosk retains its existing route. Legacy B issuer policy, historical snapshot structural reads, reprints, completed-reservation recovery, immutable source bytes, sequencing and strict issuance remain unchanged.

No fiscal provider request, reissue, existing-ticket repair, live DB mutation, ADB, reset, schema, production config, flags, bindingEvidence, Android version or Gradle change is part of this implementation. Commercial/fiscal ERP separation is an independently reviewed companion change; this POS change alone does not certify that full end-to-end flow. Historical missing/bad issuer is not backfilled or hidden.

## Developer validation

- Targeted regression: 83 tests completed successfully, including 15 new behavioral cases (`/tmp/clic-pos-precharge-regression.log`). Tests execute real production callbacks, real DB facade entry points and the production native class with an in-memory SQLite bridge. They do not establish Android/WebView hardware equivalence.
- New cases cover absent/blank/short/alphabetic RNC; valid formatted 9/11 digits; historical snapshot preservation; missing/stale/exhausted buffer rejection before writes; manual-entry and typed-finalization denial; fresh persisted authority changes; E refund; explicit NONE/order-taker; Kiosk denial before mocked provider and positive nonfiscal route; direct native invalid issuer/stale CAS; repeated reservation with one receipt and one sequence increment.
- Existing ordinary-E native regression exposed the singleton config read and now passes unchanged. An existing extracted checkout VM test was updated only with inert useRef/useEffect bindings needed by the current base's callback body; its assertions remain intact.
- `npm run build` completed; Vite reports existing chunk-size and Browserslist-age warnings. Build log `/tmp/clic-pos-precharge-build.log`.
- `npm run lint` completed with 0 errors, 39 warnings. Log `/tmp/clic-pos-precharge-lint.log`. No baseline or warning policy was relaxed.
- `git diff --check` completed.

An authority change after an earlier legitimate payment/reservation is not a global rollback. Previously authorized tenders remain available for reconciliation. The new guard prevents further invalid effects, while the native CAS protects actual frozen consumption; existing independent batching/config writes retain their real boundaries.

## Test-only baseline addendum

Separate analyst plan `/tmp/clic-pos-promised-flow-audit/plan.md` SHA256 `c220bc9a54257ef12c2d7e1c49ae449b141787fe6840ddaef161f2c7a156da74`, ratified independently by `/root/tck39_release` in `/tmp/clic-pos-promised-flow-review/plan-ratification.md` SHA256 `65eb92d5dd5629901c18fb80c83c30d0c4d6fc58345e7bbd4beaf4e8b03dbea9`. Sole test author remains `/root/precharge_developer`. These five obsolete expectations also failed on the unchanged base, independently reproduced by QA; no functional source changed in this addendum.

The actual App MSELLER callback now has a behavioral regression test for candidate OFF: two concurrent calls produce one scoped authenticated HTTP GET, no POST/ISSUE/native claim and byte-identical original documents/Outbox. A subsequent429 propagates failure without fallback or writes. The test explicitly supplies a current authenticated session while retaining expired historical pairing evidence. The obsolete App direct ISSUE-readiness assertion is removed; dispatcher's strict assertReady proof, claim/CAS/fence and negative mutation-sensitive tests remain.

Inventory OFF batch tests record V2 authority probe, V1 state probe, then one aggregate parameterized legacy SUM. The three-query budget is proven for batches of1/2/100 through the batch API;101 fails before SQL. Dedicated single-item and Session paths retain exactly one query and six-decimal results. Selected and drift cases, including batches, must reject without a legacy SUM. SQL trace from actual calls is archived at `/tmp/clic-pos-baseline-repair-sql-trace.safe.json` (synthetic scope only).

Developer checks: Node24 host focal173/173 (`/tmp/clic-pos-baseline-repair-final-focal24.log`, SHA256 `e56b1ec2a0bec1e766ed4bc82d0f5f6bfa8da77ae075bbe70600103227777a52`); related112/112 (`/tmp/clic-pos-baseline-repair-related24.log`, SHA256 `37b1ae61b74dff551233895db6bae8838e9e97f7849aa6c9612095786ad3b62b`). Lint0errors/39warnings (`/tmp/clic-pos-baseline-repair-lint.log` SHA256 `83f440dd009b315b12b1fec8c83e5cfa22fec2bcdc7fb8916a58ef7416297f6c`); Node22 `tsc -b` exit0, empty log.

Attempted Node22 native tests correctly failed because installed better-sqlite3 uses Node24 ABI137 rather than Node22 ABI127. No dependency rebuild was performed while other agents could be using it. Final independent QA owns clean installation and complete Node22 rerun; the failed ABI attempt is not reported as passing. No APK build/install, version change, provider, ERP or live data action occurred in this test-only addendum. Downstream gates remain pending.
