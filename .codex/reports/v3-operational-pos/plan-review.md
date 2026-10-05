# Independent PLAN APPROVED — bounded V3 operational candidate

Role/session: reviewer `/root/v3_plan_review`; analyst `/root/v3_operational_analysis`; orchestrator `/root`. Native reviewer role selection is not assumed: role instructions were read in this independent agent session. Reviewer has authored no functional code.

Task: `v3-operational-pos`. Exact inspected base and preimplementation candidate: `dc92365733b774203d282db23e6306ac05accb2f` (merged #820). Worktree: `/Users/felixdiaz/.codex/worktrees/v3-canary-routing/CLIC-POS`. Plan: `analysis.md`, steps 1–8, including explicit pre-gateway validation, ownership-scoped durable overlay and frozen inventory baseline.

Approved analysis SHA-256: `6ced0cbed8213123597076c850574917c9b52fe40896aa9e5b24ff5018399b9b`.

## Decision

PLAN APPROVED for implementation of the explicitly flagged, emulator-only simple PRODUCT/SERVICE candidate. This is not code approval, QA approval, APK approval, full V2 operational parity, internal deployment approval or production approval. Plan changes or implementation outside this bounded scope require renewed independent review. Existing V2 defaults remain operational.

Independent source checks corroborated: `App.handleTransactionComplete` passes legacy products to inventory deduction and later scans/recalculates legacy inventory; `processInventoryDeduction` includes noninventoriable/service lines; `PaymentModal` authorizes gateway payments before `onConfirm`; transaction fiscal normalization has a legacy tax/18% fallback; V3 runtime has no persisted binding provenance; inventory snapshot has no applied-event coverage watermark. These findings are covered by amended plan steps 2 and 5–8.

Mandatory implementation conditions:

- Persist and verify exact bound tenant/terminal/device/origin before offline reuse, no token/pairing mutation. No provenance-free snapshot acceptance and no legacy catalog fallback.
- Validate authoritative lines before provider/payment-intent mutations, partial payments, NCF/sequence allocation and final persistence. Hold a payment fence; malformed or mixed sources fail before side effects.
- Use native exact SKU/id/barcode resolution; bounded asynchronous UI query results cannot determine exact scan identity by substring top-N matching. Preserve cart cache and suppress stale responses/duplicate scans.
- Atomic financial document/history/ledger commit with deterministic movement IDs based on transaction.id plus cartId/component. Include refund and alternate commit paths; repeated completion cannot duplicate debt, fiscal, stock or documents.
- Overlay reads match baseline, full binding and warehouse, remain durable after restart/ACK, and never combine whole historical or legacy ledger balances. Every master/inventory activation/replacement path must block while local candidate movements exist absent a causal inclusion contract.
- Unsupported recipe/kit/tracking/modifier/reservation/scale semantics fail visibly rather than silent feature loss. Zero inventory never creates permission to sell unless existing explicit negative-stock policy allows it.
- V2 compatibility, independent review/QA/sync/offline/performance/device gates and signed artifact/source identity remain required. Performance evidence follows QA; do not fabricate emulator/ERP/fiscal/print outcomes.

Unrestricted inventory refresh remains blocked by missing ERP event-inclusion/watermark contract. Full V2 parity remains unapproved until all required actual operational paths are demonstrated. The approved conservative baseline cannot be represented as production-ready inventory synchronization.

No functional code was edited in this review. Architecture documents are historical evidence, corroborated against the exact base for these critical paths; no device or deployed behavior is certified here.
