> Historical PR913 record. The ERP v2 receipt contract and prepared consumer now exist in the later draft source; see [FISCAL_APPLIED_RECEIPT_V2.md](FISCAL_APPLIED_RECEIPT_V2.md). Statements below about the formerly missing endpoint describe the earlier inspected ERP SHA. Production issuance remains deliberately disconnected; no deployment or operational approval is implied.

# POS ↔ ERP fiscal boundary v1 (prepared; issuance held)

Reference ERP: draft PR [2259](https://github.com/fdiazinoa/CLIC-ERP/pull/2259), `feature/fiscal-pos-v1`, inspected SHA `03fae7c380954d15596b0dd0435db50e4e252e63`. POS base is `705b8f5c39fe94dae1f30c13bff204c63d099d27` (PR912). This is code and isolated-fixture evidence, not a deployed or MSeller sandbox integration.

## Deliberately missing production prerequisite

The ERP source checks inbox/source APPLIED and its SQL readiness guard **inside** ISSUE, but provides no sufficient authoritative client-verifiable application receipt **before** ISSUE. The POS cannot infer this authority from HTTP 200, `APPLIED`, `APPLIED_ERP`, counts, a sync ACK, an arbitrary local document, or a provider status/print proof. No readiness endpoint or receipt DTO is invented here.

`requireFiscalErpAppliedReceipt` therefore always throws `FISCAL_ERP_APPLIED_RECEIPT_REQUIRED`. App sync and manual retry invoke this hold before setting `V3_ISSUE_REQUESTED`, consuming a classification attempt, appending a submission scope, claiming dispatch, or making a POST. Existing attempted documents use the existing bounded scoped GET worker. An acceptance verified earlier remains accepted, including acceptance without QR.

The dependency-injected `assertReady` port in `createMSellerDispatcher` is **unwired contract scaffolding only**. Tests supply explicit synthetic readiness. There is no runtime setting, flag, receipt-record shortcut, or production activation path. Connecting a future ERP receipt requires another reviewed change and an exact agreed contract. No formats, capabilities, grants or credentials are activated.

## Exact prepared request

Only the currently authorized bound ERP origin is used:

`POST /api/fiscal/documents/issue`

Fresh terminal authentication comes from the existing bound transport reader plus ERP-registered terminal credentials. Six headers are required: `Authorization: Bearer <sync-token>`, `X-Sync-Token`, `X-Terminal-Id`, `X-Device-Id`, `X-Device-Token`, `X-Tenant-Id`. Missing/expired/inconsistent credentials or a token whose recorded source is not `ERP_REGISTER` hold the request. Activation/license tokens, Cloud-Admin/browser credentials, master/backend/provider URL fallbacks and redirects do not authorize dispatch. Supplied token expirations must be valid and future; absent expiration does not invent a new lifetime. Server authentication remains required.

JSON matches ERP2259:

- `providerId: "MSELLER"`, explicit numeric `environment: 0 | 1 | 2`, exact `documentCode: E31 | E32 | E34 | E44 | E45`.
- `companyInfo` and the retained original `transaction`; the request does not recalculate/reclassify lines, amounts, buyer or dates.
- `options.fiscalIssuance` is the literal original snapshot. `options.fiscalRangeId`, `fiscalAllocationId`, and `sequenceExpiryDate` come from that snapshot, preserving null expiry. No default December 31 date or current/overlapping range is selected.
- `options.credentialKey` equals the original `issuerRnc`, `deliveryMode: "DELEGATED_ERP"`; optional existing scalar tax/unit/branch/cashier options are retained. Provider endpoint options and provider auth credentials are excluded.
- A missing original issuer, tenant, or company (`null` included) is held as `FISCAL_ORIGINAL_AUTHORITY_REQUIRED`; these nullable snapshot values are never backfilled. Null expiry is supported literally. A signed negative E34 remains `FISCAL_SIGNED_TOTAL_CONTRACT_REQUIRED`; no absolute-value transformation is performed.
- Buyer identity validation matches ERP normalization of spaces/hyphens, without changing the transmitted buyer. E31/E44/E45 and E32 totals >=250000 require a 9/11 digit buyer after this validation-only normalization.

## Local durable attempt and recovery

The prepared native-only path uses the existing `saveDocumentsAtomically`/raw-CAS protocol and requires the native fiscal CAS capability. It does not claim IndexedDB, localStorage or in-memory parity.

After readiness and original-source validation, the `FISCAL_DISPATCH_CLAIM` unit contains exactly four mutations: absent sidecar `fiscalDispatchClaims/<sourceTransactionId>`, original active transaction raw CAS, independent history raw CAS, and persisted current config raw CAS. Both transaction mirrors append the original validated `fiscalSubmissionScope` and `V3_ISSUE_REQUESTED`; their other metadata stays independent. The claim stores schema version, source ID/checksum, original submission scope, authorized scope/origin, request SHA256 and claim time, never tokens/credentials. Catalog/binding guards and config issuer/store/device/environment checks execute inside the SQLite transaction. Missing/extra/duplicate/malformed mutation units, late Z membership and stale sources hold all writes. Failure at any write rolls the complete unit back before network.

The claim key is source transaction ID alone. Additive SQLite triggers reject UPDATE, DELETE and INSERT/REPLACE of an existing claim, including malformed claims. There is no TTL, reset or automatic cleanup. A crash before fetch, lost local COMMIT ACK, HTTP timeout, redirect, invalid JSON, failed HTTP, lost provider ACK, scope/config drift or process restart leaves the attempt GET-only/held. Changing provider, NCF, environment, origin or credential cannot grant a second POST. The public legacy issuer rejects switching away from a retained MSeller source or claim.

Once committed, the dispatcher rechecks authentication, retained config and source before its single POST. GET recovery uses the persisted original scope through the existing worker and typed proof CAS. It does not generate scope from a new configuration to replace an old attempt. A closed/history-only source without previously stored proof remains `FISCAL_STATUS_ARCHIVED_RECONCILIATION_REQUIRED`; no active row is recreated. Existing proofs can still be printed after Z as documented in [FISCAL_ISSUANCE_PRINT_V1.md](FISCAL_ISSUANCE_PRINT_V1.md).

## Response and acceptance authority

MSeller bypasses the generic provider normalizer/NCF rewriting helper. An ISSUE response, even `success=true`, `pending=false`, `status=ACCEPTED`, never sets SYNCED, changes the original NCF, or grants DGII acceptance. The sanitized result stays PENDING and uses a local message code; arbitrary server messages/raw payloads are not echoed or persisted.

An optional `printEvidenceProof` is retained only for the exact documented proof DTO, source `ERP_SCOPED_PROVIDER_ISSUE`, decision PENDING and valid original scoped signed evidence. Undocumented fields are dropped; original QR/security/signature fields must pass the existing strict print verifier. Signed pending printing remains distinct from acceptance. Only `GET /api/sync/v3/fiscal/documents/status` plus verified source/scope/issuer/environment/amount/NCF proof can establish acceptance. This GET uses the same six fresh authentication headers and no redirect/fallback. Legacy unscoped MSeller GET explicitly throws `FISCAL_SCOPED_GET_REQUIRED`, regardless of the candidate flag. Non-MSeller legacy routes and B-number generation remain compatible.

## Evidence and operational limits

`tests/fiscalErpDispatch.test.ts` uses actual SQLite through the native adapter and in-process HTTP. Its injected readiness is synthetic, not ERP authorization. It covers exact request/auth, one dispatch, all local write failures, commit ACK loss, restart, concurrent claimants, tamper/REPLACE guards, malformed units, config/auth/source/history races, timeout, redirect, invalid JSON, lost ACK, immutable authority/nulls, formatted buyer, signed pending proof sanitation, scoped GET recovery and acceptance without QR. Existing fiscal/print/email/refund/Z suites remain relevant.

ERP2259 remains draft; SQL installation, PostgREST behavior, native Android/WebView, actual ERP/MSeller sandbox issue/GET, printer output and physical QR scanning are unverified. No real invoices, resend, remote SQL, deployment or APK were performed. Completing client receipt readiness, the signed-negative-E34 contract and historical GET enrichment requires explicit ERP work. Rollback should revert code via PR while retaining any durable claims and their guards; deleting claims is not a safe retry strategy.
