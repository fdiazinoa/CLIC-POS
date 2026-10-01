# Critical flows

These are code-derived flows and required validation seams. They are not proof that every path currently behaves correctly.

## Sale

```text
product selection
→ POSInterface.addToCart
→ promotions (applyPromotions)
→ subtotal/tax/global and line discount/total
→ PaymentModal payment entries
→ transactionService.createTransaction
→ App.handleTransactionComplete
→ local transaction + inventory/ledger/customer effects
→ background LAN/ERP sync
→ optional ticket print
```

Evidence: `components/POSInterface.tsx`, `components/PaymentModal.tsx`, `services/transactionService.ts`, `App.tsx`, `utils/pricing.ts`, `utils/fiscalBreakdown.ts`, `utils/printer.ts`.

Required QA matrix: exact/overpayment/split/multi-currency; 0/100/>100 discount; tax-inclusive/exclusive and multiple rates; cash/credit/wallet offline policy; failure after each persistence step; print failure and restart/recovery; one business transaction after retry/duplicate delivery.

Important seam: `onTransactionComplete` is asynchronous but the baseline caller in `POSInterface` does not await it. The transaction, sequence, stock ledger, receivable and sync are separate writes, not one atomic unit.

## Tables

```text
room/map → table selection → parked ticket → add products
→ save/reopen/move (where implemented) → checkout → table release/Z inclusion
```

Evidence: `components/TableMap.tsx`, `components/TableOptionsModal.tsx`, `components/POSInterface.tsx`, `App.tsx`, `parkedTickets` and `tables` collections.

The baseline stores open orders in `parkedTickets`, while one `App` reopen path resolves `currentOrderId` from `transactions`. Pre-check, split and merge actions in `TableMap` include placeholders. Gates must not claim those behaviors pass until executable scenarios prove them.

## Z close

```text
open operational transactions → calculateZReportStats
→ preview/print/email → persist Z → archive/remove transactions
→ persist replacement collections → sync
```

Evidence: `components/ZReportDashboard.tsx`, `App.tsx`, `utils/analytics.ts`, `services/recovery/ZReportRecoveryService.ts`, printer/email services.

Validate idempotency and restart after each boundary. Printing/email uses a pre-close representation before canonical persistence at this baseline; a successful UI close is not sufficient evidence.

## Printing

```text
ticket/Z/label → formatter → PrintRouterService
→ native bridge | local print agent | browser fallback
→ success or durable offline queue (only when caller uses it)
```

`OfflinePrintQueueService` is processed on interval/reconnect, but baseline integration is strongest for labels. Ticket/Z failures must be tested separately on real Android hardware; Android suppresses browser fallback.

