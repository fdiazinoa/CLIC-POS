# Prepared POS applied receipt consumer — ERP contract v2

Task `fiscal-applied-receipt-v3`, POS base `6301a6e9c3fccd2749adb9bbe949ae61ff3b53c9` (PR913). Despite the task name, the wire DTO is **schemaVersion 2**, `ERP_POS_APPLIED_RECEIPT_V2`, profile `POS_V3_DIRECT_STOCK_PER_DOCUMENT_DOP_V1`. There is no v1 fallback or receipt schema3.

Inspected ERP [draft PR2259](https://github.com/fdiazinoa/CLIC-ERP/pull/2259), exact SHA `4596abe930c6f582773c9c641bf23ab3376b7ee1`, contract `docs/ERP_POS_FISCAL_APPLIED_RECEIPT_V3.md`. This supersedes the missing-endpoint finding recorded historically in [FISCAL_ERP_BOUND_DISPATCH_V1.md](FISCAL_ERP_BOUND_DISPATCH_V1.md), without activating issuance.

## Production remains disconnected

`requireFiscalErpAppliedReceipt` and the App production MSeller entrypoint still throw `FISCAL_ERP_APPLIED_RECEIPT_REQUIRED` before any applied-receipt GET, claim or POST. The new `createAppliedReceiptReadiness` factory is dependency-injected prepared code only. No flag, runtime switch, default-factory substitution, scheduler, reconnect hook or permissive null/void readiness path was added. A missing/old/malformed prepared result holds issuance. Production connection requires separate review, real prerequisites and explicit authorization.

The ordinary POS constructor does not retain the historical environment used by this profile. Such unmodified originals remain `FISCAL_APPLIED_HISTORICAL_ENVIRONMENT_REQUIRED`; this change does not capture a new environment, repair old events, complete null authority, or select current ranges. E34 positive is outside this receipt profile; signed negative E34 remains `FISCAL_SIGNED_TOTAL_CONTRACT_REQUIRED`. Closed/history-only sources or absent active/history mirrors hold before GET. Existing historical proofs remain printable through their existing verified path.

## Original source and identity

The native readonly loader retrieves bounded original `SALE_POSTED` / companion `PAYMENT_POSTED` rows from `sync_outbox_v2`, including **every status**. It captures exact event UUID, type, aggregate association, schema version and raw `payload_json`. It never repairs a contract, reconstructs an ID, chooses latest, drains Outbox, changes lease/status, or treats local APPLIED_ERP as authority. NONE requires one SALE and no PAYMENT; CASH requires the original companion. Extra candidates, including rejected/foreign aggregate aliases, hold.

The three partial indexes cover aggregate ID and the two original transaction/summary aliases. The predicate repeats the event-type condition in each OR branch so SQLite uses `MULTI-INDEX OR` with three `SEARCH` operations, rather than scanning an index. LIMIT4 is an ambiguity sentinel, not a latest selection; there is no ORDER BY. Index creation is additive local DDL only. It affects local boot/writes and requires performance validation; see the evidence limits below.

`financialIdentity`, `financialOperationIdentity` and their options type were moved unchanged into the existing pure `LargeMasterSyncV3FinancialRetention` module. Financial commit and receipt validation reuse the same functions and exclusion lists; no second fingerprint algorithm/list was introduced. Full original Product/CartItem fields, snapshot, all top-level stamps and complete per-line stamps are retained. Literal catalog7/stock6 authority is valid. Financial protected identity and the five stamps compare independently with active/history; ACK/status metadata may differ without replacing the original wire transaction.

The body sent to ISSUE uses the **literal original Outbox transaction**, not a pruned mirror or reconstructed serializer output. The current mirror/history/config are separate raw-CAS anchors. Array order, explicit nulls, original IDs, NCF, expiry, amounts, timestamps and fingerprint strings stay unchanged.

## GET and public validation

Exact route: `GET /api/fiscal/v2/documents/applied-receipt` at the existing authorized bound ERP origin. Six fresh headers are reused from `FiscalBoundContext`: Authorization Bearer(syncToken), X-Sync-Token, X-Terminal-Id, X-Device-Id, X-Device-Token, X-Tenant-Id. No body, redirects, credential refresh or fallback origin/provider/local backend is allowed.

The exact query carries `sourceTransactionId`, original SALE `sourceEventId`, `sourceEventType=SALE_POSTED`, fiscal `sourceChecksum`, literal `ncf` and original numeric environment serialized as 0/1/2. Only CASH adds original `sourcePaymentEventId`. Environment declarations supported by ERP in the original transaction/summary must exist, be numeric 0/1/2 and agree; current config/input cannot substitute for missing history.

Only HTTP200 JSON plus exact READY/code/schema/source/profile qualifies. Unknown/extra/missing nested DTO fields, partial receipts, 304, HTML, redirect, auth/infra/business errors and unknown versions/codes hold. Scope, issuer/company-account RNC, historical environment, document NCF/type/signed total/DOP, full original fiscalIssuance and posAuthority must match original anchors. Required server UUIDs allow versions1–8 and are never rewritten. Materialization arrays must be nonempty/unique and their warehouse must equal the original. Journal/COGS cardinality is not invented; zero cost can legitimately produce fewer rows. New ERP document/plan/inbox/movement/receipt/local IDs and cost/location policy remain scoped **server assertions**, not facts independently recomputed from POS.

Public checksum algorithms remain distinct:

- SALE: unchanged `SHA256_CANONICAL_JSON_FISCAL_SOURCE_PROJECTION_V1` over the existing fiscal projection.
- PAYMENT: SHA256 of canonical `{summary, payments, occurred_at, paymentIntentIds: original.paymentIntentIds ?? null}`. Complete summary/ordered payments/literal timestamp/intents are retained. Absence/null differs from empty `[]`.
- Operation fingerprint is the existing JSON string, not SHA.
- ERP plan digest and `observation` digest are opaque. The client verifies their documented format, preserves them, and returns the exact observation pin; it cannot reconstruct their private preimage or turn them into a signature, lease, TTL or capability.

Safety caps are local transport limits: original raw source <=512000 UTF-8 bytes (matching the profile source limit); response stream <=2MiB; materialization lists <=4096 each. These are not invented fixed ERP ledger counts. Response size is checked while streaming before JSON parsing. Complete accepted source fields are not removed to meet a cap.

## Atomic pin and one dispatch

Readiness returns the validated receipt, exact expectation, original transaction and raw SALE/PAYMENT anchors. `createMSellerDispatcher` independently revalidates them before building the request. Its schema2 append-only claim retains `appliedReceipt`, `appliedReceiptExpectation` and `outboxAnchors` with the original source ID/checksum, original submission scope and request SHA256; no tokens are persisted.

The existing four-write `FISCAL_DISPATCH_CLAIM` transaction remains: require-absent claim, active source CAS, independent history CAS, unchanged current config CAS. The native validator revalidates the public receipt/profile/anchors against original protected source, not a nominal TypeScript type or caller-approved boolean. **Inside BEGIN and before any claim write**, it re-queries exact Outbox association/raw bytes and complete bounded candidate cardinality, plus existing baseline/mirror/config checks. Any failure rolls everything back. Claim+receipt+pin cannot be stored separately. Existing schema1 claims remain retained as historical attempt evidence, but new native claim batches and the public dispatcher require schema2 receipt-aware readiness; downgrading/stripping fields to schema1 or returning void cannot authorize a new claim or POST.

After commit, authentication, config, active source and Outbox anchors are reobserved before the single POST. Any observable drift holds with the immutable claim retained. The final local-read→fetch window still exists; ERP separately reobserves its source/plan/materialization/guard/pin before credential metadata and provider access. Neither side's pin proves absence of future drift.

Exact `options.appliedReceiptExpectation`, outside transaction/fiscalIssuance:

```ts
{
  schemaVersion: 2,
  source: 'ERP_POS_APPLIED_RECEIPT_V2',
  profile: 'POS_V3_DIRECT_STOCK_PER_DOCUMENT_DOP_V1',
  sourceTransactionId: originalTransaction.id,
  sourceEventId: originalSale.event_id,
  sourceEventType: 'SALE_POSTED',
  sourcePaymentEventId: originalPayment?.event_id ?? null,
  sourceChecksum: originalSaleFiscalChecksum,
  observation: exactReceipt.observation
}
```

Any existing claim, timeout, lost ACK, malformed response, HTTP error/redirect, server materialization drift, crash before fetch or lost local COMMIT ACK remains GET-only/held indefinitely. No second POST, TTL/reset, source rewrites, active resurrection or legacy degradation is introduced. Existing bounded status worker now treats absent/null fiscalSyncStatus as pending **only within its existing MSeller+scope+attempt+binding filters and limit10**. It does not persist a status or infer acceptance. Explicit SYNCED, unscoped, unattempted and foreign binding candidates remain excluded.

ISSUE remains PENDING even if its HTTP payload says accepted. Only existing verified scoped GET status establishes acceptance; accepted-without-QR remains accepted and may later enrich signed print evidence. Signed pending ISSUE proof remains distinct and sanitized. Non-MSeller/legacy B behavior remains covered by regression tests.

## Fixtures, measurements and limits

The six `tests/fixtures/fiscal-applied-receipt-v2/*.json` wire fixtures are byte-exact copies from the ERP SHA above, with tracked original hashes in `provenance.json`. `tests/fixtures/fiscal-applied-vectors` retains the independent adapter/serializer habitual/lab/type vectors and source provenance. Habitual missing-environment originals are not repaired to make a positive case.

Tests use real host SQLite through the native adapter and local HTTP sockets. The fixture ERP origin stays `https://erp.fixture.invalid`; an explicit injected **test-only fetch forwarder** records the bound URL and forwards only its socket to loopback. No frozen binding is changed, and no fixture positive is described as native capture or deployed ERP/provider evidence.

Creating three indexes on a populated host in-memory table of 10,200 envelopes (17,581 bytes each) was measured separately: ~74.87ms in one recorded run. Isolated INSERT p95 (n=200) changed 0.009167→0.016625ms (+81.36%, +0.007458ms); lookup p95 ~0.003875ms. This isolated INSERT increase exceeds the 20% tolerance and is not approved against that threshold. These are fixture measurements, not Android boot/UI/financial-commit budgets or performance approval. Raw samples and subsequent comparable measurements are retained in the task dossier; an independent performance gate decides significance. Index creation/writes are not free and are not hidden by the disconnected production endpoint.

No ERP modification, remote SQL, deployment, real issue/resend/provider, APK, credentials/grants or formats activation occurred. ERP2259 remains draft; remote SQL/guard/PostgREST, actual environment capture, native Android/WebView/bridge, authorized MSeller sandbox, printing/QR and representative performance remain unverified/blocked. Reverting code must retain existing claims/guards; deleting them is not recovery. This is prepared source delivery, not complete operational integration.
