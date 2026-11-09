# Independent G0/G1 final ratification — company warehouse dispatch

Evaluator `/root/operations_review`, 2026-11-06. **G0 PASS / G1 PASS for the final plan**, not for implementation or release. No source, migration, database, APK or operational device changes were made by this evaluator. No runtime tests were executed for this plan review.

## Revisions and authorship

ERP base `68519916a1c8f2007c6146edc6a70b496efc3cff`, docs HEAD `1d4432c58385cc865ef496a8f6cedfdbd9824d48`, worktree CLIC-ERP-company-dispatch, task expediente docs/development/tasks/company-warehouse-dispatch.md. POS official base `1e3273e94309c2a4e50b19767cef981eaf51f5dd`, subsequent task documentation `ac5474ea`, separate CLIC-POS-company-dispatch worktree. ERP clean-erp and POS develop are their respective authorized bases; original dirty/conflicted worktrees are excluded.

Plan author `/root/analysis`; data/accounting and costing/fiscal proposal author `/root/data_validation`; native POS/integration diagnosis `/root/pos_dispatch_analysis`; coordinator `/root` owns scope/UX decisions and task documentation. Reviewer authored no part of the evaluated functional result and did not edit the proposed plan. Review comments and required invariants were incorporated by its authors.

Read ERP AGENTS, WORKFLOW, reviewer profile, six architecture maps and required CODEX_HANDOVER/setup-terminal-api; POS AGENTS/WORKFLOW/offline/sync architecture and the native analysis; actual sales, accounting, inventory, fiscal and native commit/reader seams were inspected. Historical architecture snapshots are not substituted for the frozen current bases.

## G0 determination

The diagnosis correctly identifies current IMMEDIATE stock/COGS effects in ERP direct FACTURA/CONDUCE and POS ordinary V3/article-format writers, the non-atomic existing REST chains, legacy POS V1 physical-only admission, overlapping tracking/omni ownership and native SQLite/BASE4/BASE6/ACK snapshot boundaries. Native precharge/payment/fiscal, frozen-source verification and CASH_CLOSE ownership are in scope. Backend-only implementation cannot satisfy the authorized offline requirement. G0 ratifies this actual cross-repository impact map and the explicit unresolved-runtime/deployment limits, not a deployed behavior.

## G1 final decisions ratified

Final plan SHA256 `035d34e5a33d14844ed578e097deaded96e2aee0c4bacc532021d77298d9f574` closes the finite review conditions:

1. Default IMMEDIATE and historical sealed versions retain their original effects. New WAREHOUSE_DISPATCH is server-owned, versioned and immutable per source; an allowlist of atomic kernel actions covers real-sale creation, hold/adoption, waybill creation, dispatch, pending release, physical return, policy transition and quota ownership. No browser skip flag, fictitious PEDIDO, fabricated LOT/SERIAL, direct projection write or unverified company JSON provides authority.
2. Exactly one global hold funds each obligation. Unspent issued escrow is separate from real-document omni projection; intake moves quota U6 to document H6 in one TX without releasing/doubling capacity. All writers/allocators sharing the pool, including legacy admission and tracking, must respect the same locks and disjoint ownership. Existing bins decrement is not repeated by the kernel; headers and proof conservation are reconciled in the same TX.
3. Cutover includes every potentially authorized historical terminal/binding/generation, not just active/lastSeen devices. Unknown offline rights block activation/issuance; server intake rejection or token revocation cannot prevent goods already delivered offline. Native durable barriers, acknowledged/drained materialization watermarks and ownership reconciliation are prerequisites. The effective change back to IMMEDIATE is blocked until ZERO_PENDING_RIGHTS and all-pool barriers; it never cancels orders or releases unknown rights automatically.
4. Quota BASE6 integer rights and commercial BASE4 exactness are specified, with q6=100*q4 and exact partition sums. Incompatible precision rejects before payment, never rounds at dispatch. Local grant/prepared/consumed/returned/fenced quantities are disjoint, and consumed counters are not decremented by ACK/refund. Signed/versioned snapshot prefix/cursor plus event ID/hash absorption keeps old/new baselines and local overlays from double holding or subtracting stock twice. Deferred sales never create local physical/COGS effects.
5. Durable native prepare reserves capacity under the stable checkout ID/digest before external gateway/fiscal effects; EFFECT_POSSIBLE is persisted before making the external request. Ambiguous close/cancel/timeout cannot release the hold. COMMITTED recovery precedes new quota acquisition; the final native transaction moves prepared to consumed together with source/document/payment/fiscal/Outbox. External providers are explicitly not part of a distributed SQL transaction: durable idempotency and reconciliation retain uncertain rights.
6. New discriminated fiscal/native contract versions prove the real reservation and NOT_DUE COGS ownership, rather than deleting old movement expectations or faking zero cost. PER_DOCUMENT/CASH_CLOSE revenue/tax/settlement remain owned by their existing producer, while deferred dispatch alone owns COGS. Existing historical validators/receipts are unchanged; later dispatch effects append without rewriting the original signed birth proof.
7. Cost proposal is ratified: resolve the existing current LAST/AVERAGE policy at each actual dispatch, using authoritative company/item state and current cost under shared locks; freeze that effect once. A sale estimate does not freeze a financial cost layer. Delivered returns reverse the original effect cost/account/amount with caps and final-cent preservation; undelivered cancellation has no physical IN or COGS. No FIFO method is invented. New SALES_DISPATCH_COGS is keyed by a sealed dispatch event and linked CONDUCE, not a general relaxation allowing arbitrary ERP journals over POS invoices.
8. Mixed credit notes explicitly partition pending release versus delivered physical return using original effect IDs, and do not reopen quota automatically. Period/account/FX/readiness failure rolls back the SQL operation while retaining the hold. Service/non-stock eligibility is determined canonically, not by client flags.
9. Full operational UX is included: policy actual/target/PREPARING/barrier progress, quota assignment/return/witness/unknown states, real invoice-to-waybill partial selection, location/bin confirmation and append-only movement/cost lineage. Permission/scoping matrix covers policy, quota management, terminal service ACK/barrier, sale, waybill, dispatch and returns, with real bearer/DB tenant/company/store/warehouse/source authority.
10. Root's final shared-catalog decision is explicit: stock with company_id NULL is ineligible for this new mode before issuing quota or charging, rather than weakening the existing bins company guard or silently migrating masters. Foreign scope is denied, exact-company items are isolated and canonical services remain quota-free. This prerequisite does not claim support for every shared catalog profile and must remain explicit in later acceptance/release documentation; IMMEDIATE operation is not implicitly changed.

## Validation and budgets

The POS preventive workflow plan is CRITICAL before implementation; final candidate diff must be reclassified/verified. Independent reviewer, QA, sync-validator and performance evaluators remain distinct from each other and all authors as required by POS AGENTS. Device/native SQLite evidence is mandatory, not NA for lack of environment. Owned PostgreSQL17 UTF8, actual Capacitor SQLite/emulator laboratory, cross-repository offline/crash/retry/ordering/ACK/snapshot and payment/fiscal uncertainty tests are planned; mocks alone cannot certify them. No production APK installation or operational data reset is authorized.

Pre-measurement budgets are defined: POS input-to-visible p95<=50ms, separate SQLite prepare and commit p95<=200ms, ERP page budgets distinct, SQL birth/confirm p95<=250ms single representative workload and hot-pool eight-writer p95<=500ms; historical data, cart/split sizes, samples/distributions, query counts and safety-preserving baseline comparisons are fixed. Performance must follow real functional QA; no timers, discarded work, reduced security or small-fixture substitution can create PASS.

## Eligibility boundary

This review permits assigning the single functional implementation writer under the ratified plan. It does NOT approve G2/G3 code, QA, data/runtime integration, performance, release, remote migration or deployment. Existing bins/financial schema incompatibilities remain separate rollout blockers. The final result must implement the authorized ERP+POS offline flow; fail-closed unsupported paths are not a completed subset or an online-only replacement. New scope or changed invariants return to plan review. A later SHA requires exact plan/source/evidence identity checks, not inherited approvals.

## Artifact hashes

- `/tmp/clic-company-dispatch-analysis-plan.md`: `035d34e5a33d14844ed578e097deaded96e2aee0c4bacc532021d77298d9f574`.

- `/tmp/company-dispatch-data-g0.md`: `ca836aec3bba8c019bc379800fcd1e52914a8fd85beedbf0fca74d6c9ab4307f`.

- `/tmp/company-dispatch-cost-fiscal-decision.md`: `25633a608119aee0c6a303258051f50dad2d6339ee840a374fa29e33c3c2ea5f`.

- `/tmp/company-dispatch-pos-analysis.md`: `acb71fd84cbfba2a36c5d6015eeb3bd8e6064e3fb9aa6ab51e0c92e853a3a125`.

- `/tmp/clic-company-dispatch-pos-plan.json`: `731b9f30afa58b2f935c9160ee8ca63e448a697ee5acd02b4caf56bdc3f32b81`.
