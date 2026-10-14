# Controlled pre-submission evidence repair

`scripts/diagnostics/fiscalPresubmitEvidenceRepair.ts` prepares one explicitly scoped incident repair. It is not an automatic migration, retry or provider reconciliation rule. The native immutable financial source, both persisted invoice copies, trusted archived read-only evidence and independently reviewed blocked retry provenance must agree. The historical archive contains whitelisted fields, not a full original transaction checksum; the repair seals the current full financial source and records this limitation.

Preparation makes no device, database, provider or network calls. Its output contains exact expected-document CAS mutations; do not log or publish their full payloads. Report only hashes and scoped invoice identity. Preserve private payload permissions and original evidence hashes.

Execution requires the exact prepared operation checksum and separate explicit human approval. It uses only the native adapter's typed fiscal metadata CAS capability and updates transactions plus transactionHistory atomically. The installed 1.1.513 adapter does not support this capability. That APK cannot execute this repair: a reviewed updated APK must first be installed and its native capability/current scope checked. Do not bypass this limit using ADB SQLite writes or a generic restore endpoint.

The repair restores only the two archived deterministic error/response messages and appends protected audit metadata. It preserves ERROR, V3_ISSUE_REQUESTED, NCF, provider references, source epochs, payments, amounts, stock and outbox. Any accepted/receipt proof, consumed projection, stale copy, missing history, changed source, foreign scope or uncertain intervening submission refuses the operation. A provider NOT_FOUND response alone never authorizes repair or resend.

The archived 513 code/APK provenance describes the observed blocking manual-retry incident. It is distinct from the newer adapter required to execute the reviewed operation. Recheck current company/terminal/catalog authority and both invoice documents after installing that APK; old snapshot hashes cannot authorize a changed document.

Successful repair restores eligibility for explicit fiscal classification correction, not permission to send a document. ERP must explicitly classify the unchanged tax as SERVICE_CHARGE10 and synchronize the authenticated V3 catalog before correction can succeed. Correction remains held; later explicit retry consumes the protected one-shot marker before any provider issue request.
