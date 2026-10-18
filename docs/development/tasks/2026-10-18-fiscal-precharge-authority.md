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
