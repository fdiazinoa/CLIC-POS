# Native format financial transaction — after develop PR894

Status: internal storage bridge under implementation/review. Formats stay OFF. All six integral readiness checks remain false; operational `articleFormatSQL()` retains `NATIVE_UNPROVEN`. The internal `articleFormatFinancialSQL()` port represents a narrow normalized-V3 financial unit of work, not permission to negotiate or sell formats.

## Transaction boundary

The existing CapacitorSQLiteAdapter write queue and native database are reused. The financial port opens the plugin's tracked `beginTransaction()` before authoritative reads. On Android the installed plugin calls SQLiteDatabase.beginTransaction(), an EXCLUSIVE transaction (stronger writer acquisition than deferred BEGIN). The scoped port performs direct queries/runs on that connection and commits once. No nested executeSet/BEGIN, second Outbox, second financial database or ambient transaction bypass is introduced. Network, UI publication and sequence broadcast run outside the SQL transaction.

Public generic document/query reads and normalized master read APIs wait behind this same queue. Internal master mutations retain their established direct connection and writer lock. An exhaustive, compile-checked public master-method concurrency classification avoids nested queues; unknown methods fail explicitly. Existing numbered-master creation uses an explicit internal document reader.

The existing format planner writes canonical sale/history/payment rows, shared global/series counters, optional LEGACY_B buffer and local issuance receipt, normalized base-unit ledger, format journal, unchanged wire event/return_context and dedicated format Outbox in one commit. Stable IDs/content are checked before new-admission guards. A lost COMMIT response is classified as uncertain and replay resolves the original event; it does not compensate stock or manufacture new IDs. A lost BEGIN response is inspected/rolled back. Failed state probing/rollback poisons that connection until explicit disconnect/reopen.

## Inventory and history

Formats revision authenticates snapshots/prices/policy. Normalized V3 owner and inventory anchor independently authenticate physical stock. Their sync IDs/revisions are not assumed equal. Both are frozen in committed financial projections. Availability is normalized baseline plus indexed canonical local base ledger delta; normalized balances are not also decremented and no products/productStocks shadow is saved.

Queries are bounded to current line IDs/items, original transaction/event, relevant series/global/fiscal rows and source returns. Aggregate demand uses existing native V3 financial preconditions. Historical returns retain the original format factor, cost, price, tax/discount policy and ERP-authorized physical return policy. A new format master Caja12 cannot reinterpret a pending/historical Caja24 line.

Selective retention protects format-owned financial content while permitting ordinary legacy records and allowed ACK/sync metadata. Generic collection replacement retains committed base ledger/history/payments; it cannot erase the local stock delta. Shared numbering uses one typed native reservation for ordinary transaction-service/utility callers; the manual refund path also reserves its REFUND series through this boundary. Counter merges retain issued numbers while accepting current administrative prefix/padding/active metadata. Omitted series become inactive while retaining issuance high-water; buffer cache deletion remains possible and cannot erase issuance receipts.

## Fiscal scope

LEGACY_B reuses the existing pure terminal/lot/allocation policy and batch allocator. Native reservation checks exact config, buffer, allocation and range rows in the transaction and revalidates current policy before consuming a number. Format fiscal consumption happens within the financial commit, never through prior standalone reservation.

Local nativeFiscalReservations documents are issuance receipts only, not transport events or grants. For a proven issuer their immutable key uses canonical issuer RNC plus the NCF, so allocation/range/terminal/company mapping rotation cannot create a fresh number namespace. Bounded indexed historical collision checks do not treat missing old receipts/issuer history as permission to reuse a number. Ordinary eligible legacy issuance without RNC/tenant/company still works for a fresh number. It saves an explicit `UNATTRIBUTED_LEGACY` exclusion claim with issuerRnc:null, never fabricated issuer proof. Any matching unknown claim blocks a later known or unknown issuer because separation cannot be proven. Different known issuers are separated only by immutable validated evidence; old unproven issuer text or today's config cannot backfill history.

Historical NCF fields are checked separately (`ncf`, `legacyNcf`, `electronicNcf`, `fiscalCertifiedNcf`, `articleFormatWire.fiscal.ncf`) with identical normalized index expressions and bounded point queries. Creating these partial indexes visits existing `documents` rows to evaluate the predicate; it does not read normalized `master_v3_articles`. Source history already purged before this additive feature cannot be reconstructed, so this is not proof of absolute historical/global/cross-device uniqueness. ECF issuance keeps its existing path. The exact native device proof remains an independent gate; host tests do not constitute native plugin proof.

## Explicit integration blocker

An ERP event ACK confirms financial acceptance, not whether an inventory baseline includes the event's stock movement. Current terminal-inventory-coverage-v2 completes SKU×warehouse coverage; it is not authenticated per-event/per-line stock-effect coverage. Absorbing a local delta on ACK or adding it again over a baseline that already includes it would produce wrong stock.

The existing normalized V3 coverage guard therefore rejects a baseline replacement while committed local movements exist, including after a valid event ACK. It preserves the active pointer and the original local delta. Pending format Outbox content, IDs, hash and return_context stay unchanged across hold, restart and retry; context conflict never triggers renegotiation, a fabricated ACK or legacy fallback.

The required ERP task is provided in [ARTICLE_FORMATS_INVENTORY_COVERAGE_ERP_PROMPT.txt](ARTICLE_FORMATS_INVENTORY_COVERAGE_ERP_PROMPT.txt). It is a proposed contract extension, not code deployed or executed by this POS task. Formats cannot be admitted until coverage/rebase and integral readiness are independently proven.

## Evidence boundaries

`tests/articleFormatsNativeAtomicity.test.ts` executes actual production adapter/planner/master code against real host SQLite. It covers native transaction entry points, write/read failure injection, uncertain commit, file reopen, reader barriers, shared legacy numbering, financial concurrency, source returns, immutable payloads and baseline rejection. This is not Android plugin proof. The independent synthetic-device harness must execute the actual production classes with the installed Capacitor plugin in a separate database. La Bomba operational financial data must never be used for synthetic sales, fiscal issuance or resets.

No flag/capability/grant, ERP SQL, production endpoint deployment, Android version or APK installation is changed by this source implementation. Startup tolerance is separately user-approved at baseline p95×1.10; financial atomicity retains zero tolerance for partial effects.
