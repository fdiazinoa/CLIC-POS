# POS fiscal issuance and print evidence v1 (additive contract)

Status: POS implementation; ERP projection/route changes and isolated provider validation are prerequisites. No production deployment, historical repair, automatic reissue or formats activation. Current ERP inspected at `origin/clean-erp` accepts only E31/E32/E34 in its route/proof, even though MSeller documents E44/E45 support. The POS extension covers E31/E32/E34/E44/E45 only.

## Issuance authority

NEW B01/B02/B04/B14/B15 are prefix3 + sequence8 (11 characters); NEW E31/E32/E34/E44/E45 are prefix3 + sequence10 (13). Positive safe integers only; overflow rejects. Historical NCF, original event IDs and pending payload/checksums are never padded, renumbered or replaced. Historical short E lookup uses existing numeric identity; native reservation collision checks also recognize that identity without changing old rows.

`db.reserveFiscalNumber` returns `{ ncf, fiscalIssuance }`. The reservation uses the existing local lock; Android validates exact config/buffer/allocation/range bytes and records the claim in its native SQLite transaction. Snapshot is constructed from those same native CAS bytes, and then stored with the sale/refund financial unit of work (including inventory and existing Outbox policy). Reservation can consume an unused number if checkout later fails; it never releases/reuses it. Web still uses existing serialized collection persistence and is not equivalent to native atomic reservation.

`Transaction.fiscalIssuance` is `FiscalIssuanceSnapshot`:

```json
{
  "schemaVersion": 1,
  "source": "POS_FISCAL_RESERVATION_V1",
  "ncf": "E310000001021",
  "ncfType": "E31",
  "sequence": 1021,
  "fiscalRangeId": "original-erp-range-id",
  "fiscalAllocationId": "original-terminal-allocation-id",
  "prefix": "E31",
  "rangeStart": 1,
  "rangeEnd": 9999999999,
  "allocationStart": 1001,
  "allocationEnd": 2000,
  "expiryDate": "2027-12-31",
  "issuerRnc": "130090752",
  "tenantId": "tenant-id",
  "companyId": "company-id",
  "terminalId": "terminal-id",
  "capturedAt": "2026-10-16T16:00:00.000Z"
}
```

`expiryDate`, `issuerRnc`, `tenantId`, `companyId` can be null when the actual download lacks them. Missing fields are not authority to guess them. ERP must require authenticated matching scope and real original range before dispatch when required. No Dec31/year-of-sale expiry fallback.

`SALE_POSTED.transaction.fiscalIssuance` preserves the exact object; summary fields are `fiscal_issuance`, `fiscal_range_id`, `fiscal_allocation_id`. Existing legacy sale/refund envelopes retain the additive transaction field. Requests through existing fiscal `/documents/issue` transport send `options.fiscalIssuance`, `options.fiscalRangeId`, `options.fiscalAllocationId`, and `options.sequenceExpiryDate` from that snapshot. MSeller non-E32 requests without original range fail `FISCAL_ORIGINAL_RANGE_AUTHORITY_REQUIRED`; current/default lot is never substituted. This does not authorize rewriting already queued events or reconstructing historic authority by numeric overlap.

## Optional signed print evidence

Existing scoped `FiscalStatusProof.schemaVersion=1` retains all tenant/company/terminal/device/store, issuer/credential company/RNC, environment, source ID/checksum, original NCF and exact amount guards. Additive `providerReceipt.printEvidence`:

```json
{
  "schemaVersion": 1,
  "qrUrl": "https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=E320000001021&MontoTotal=352.00&CodigoSeguridad=NVrTbH",
  "securityCode": "NVrTbH",
  "signedAt": "15-10-2026 23:30:53"
}
```

Values are authoritative provider `qr_url`, `securityCode`, `signedDate` mapped without modification. No generated URL, track ID, hash or local timestamp substitute. `signedAt` uses literal provider civil timestamp `DD-MM-YYYY HH:mm:ss`; provider formats outside that contract remain unavailable instead of being guessed. Scope `environment` mapping: 0=`testecf`, 1=`certecf`, 2=`ecf` (MSeller mapping).

GET proof `source` remains `ERP_SCOPED_PROVIDER_GET`. Authenticated issue response may add `printEvidenceProof` of the same scoped proof shape with `source=ERP_SCOPED_PROVIDER_ISSUE`; all guards still apply. `lookup.requestedNcf` is the exact original submitted identity. A signed PENDING proof authorizes print evidence only, never acceptance. ACCEPTED status requires the existing GET acceptance proof; `fiscalSyncStatus=SYNCED` alone does not label the printed fiscal block accepted. HELD/REJECTED proofs do not yield this print block. Provider credentials/raw HTML do not cross the contract.

DGII HTTPS hosts are exact `fc.dgii.gov.do` for E32 total <250000 and `ecf.dgii.gov.do` otherwise; paths `/{environment}/consultatimbrefc` or `/{environment}/ConsultaTimbre`. No credentials, fragments, unexpected/duplicate query parameters. FC requires issuer/ENCF/amount/security; general additionally buyer RNC, issue date and signature timestamp. Query values must match source/proof exactly (amount within existing cent tolerance). Fiscal issue date uses frozen transaction instant interpreted in America/Santo_Domingo, not its UTC date slice. Exact provider URL is rendered unchanged after checks.

`FISCAL_PRINT_EVIDENCE_APPEND` is a typed native CAS operation appending only `fiscalPrintProof`, `fiscalPrintScope`, `fiscalQrUrl`, `fiscalSecurityCode`, `fiscalSignedAt`. The exact original authenticated submission/lookup scope is retained as `fiscalPrintScope` on each mirror (history may legitimately lack `fiscalSubmissionScope`). Both mirrors commit atomically without changing financial data, stock, sequences, Outbox or acceptance. Ordinary sync cannot clear the protected proof/scope/date. Status acceptance continues through its distinct typed operation. Already accepted rows can receive signed evidence via explicit consultation without reissuing.

Reprints refresh the persisted transaction before resolving evidence; HTML/ESC-POS have a separate fiscal QR/security/date block from internal returns/coupon QR. Email DTO adds optional `fiscalPrintEvidence={schemaVersion,qrUrl,securityCode,signedAt,certifiedNcf}` only from verified presentation; ERP email renderer integration remains required.

## Refund and Z invariants

Fresh active/history financial original is checked before approval/provider/numbering, with enumerated root transport/fiscal metadata excluded only. Nested item/customer/payment fields remain identity. Raw native CAS remains strict. History-only original requires its persisted `zReportId`; updates stay in history, never recreate active sale and never create a ticket settlement. Independent metadata on each mirror stays independent. Refunding retains original line/NCF identity and the original invoice range snapshot as an immutable reference; the NEW credit note reserves its own E34 (or B04) allocation/range and snapshot. no historic source mutation to match today's customer or master.

Refund Confirm is immediately locked before any await and awaits the full approval/preparation/commit callback; visible busy and error state always settle in finally. Existing provider ambiguity/reconciliation policy remains in force; this is not permission to retry a provider financial effect.

Session warning and Z/finance selectors share explicit closed history/Z membership and in-progress close reservations. Fiscal/sync PENDING is not closure. Old unclosed operations remain pending regardless timestamps. Late fiscal callback cannot recreate a closed active sale. No date/display-sequence heuristic is used by this new selector or as archived-refund authorization.

## Explicit integration/validation limits

* Historical short NCF/missing-range invoices remain immutable and need separately authorized ERP reconciliation using original authoritative evidence. No automatic repairs.
* Scoped status worker currently requires an active+history pair. A history-only post-Z invoice that already has print proof reprints it; a history-only invoice missing proof cannot acquire proof through this worker. `FISCAL_STATUS_ARCHIVED_RECONCILIATION_REQUIRED` holds absent active V3 publication. Do not recreate active rows. Archived GET/enrichment needs a separately reviewed retained-history contract.
* Existing Z preview recovery code has an older display-sequence reconciliation heuristic; this change does not use it as authority and does not certify whole-Z atomicity.
* Native UI Confirm responsiveness, actual case state, live MSeller acceptance, physical printer/QR scan and ERP email cannot be certified without device/provider sandbox. User confirms no Mac emulator. Tests are isolated SQLite/transport fixtures; they do not prove deployed endpoints or real invoicing.
* Article formats remain OFF. No APK, version increment, install, flags/grants, Cloud Admin, remote SQL or production records changed.

Official references: [DGII structure](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/TipoyEstructurae-CF.aspx), [MSeller printed representation](https://docs.ecf.mseller.app/docs/integration/representacion-impresa), [MSeller supported types](https://ecf.mseller.app/desarrolladores).
