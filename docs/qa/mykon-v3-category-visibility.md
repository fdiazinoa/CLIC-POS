# MYKON V3 category visibility

## Evidence and limits

The supplied remote screenshot shows 3,010 active/sellable articles in the read-only V3 catalog. The operator reports no result in sales, including code search. A read-only ERP config GET independently returned 3,010 items with POS category Todos1 and the existing terminal allowlist Todos1. The remote native database, installed source commit and sales diagnostics were not inspected; the exact remote cause is not yet proven.

The screenshot's “Sin categoría” describes categoryId (ERP classification), not posCategoryId. It does not establish that the POS category was lost. The current V3 importer persists the original article and indexes posCategoryId/category; no importer rewrite or data repair is justified by this evidence.

## Reproduced defect and change

When local POS category masters are missing, reconcileBoundV3PosCategories previously returned no identities even if the bound priced V3 catalog supplied the exact category UUID and label. isProductAllowed then rejected every UUID-bearing product under an existing named allowlist, including text search results.

Derive missing category identities in memory from the current bound priced catalog. Preserve configured identities, restrictions and inactive presentation. Reject ambiguous labels/IDs and conflicting configured aliases. Never update configuration, articles, prices, taxes, balances or financial snapshots. No extra database queries are added. The helper is shared by sales and kiosk.

## Local validation

- 34 category/snapshot/operational tests pass, including SQLite UUID selection, empty masters, named allowlist, unknown IDs, conflicting labels, price/tax and stock guards.
- MYKON-shaped regression covers 3,010 products under Todos1 without changing the input configuration.
- TypeScript + Vite production build pass; targeted ESLint and diff whitespace checks pass.
- The existing SQLite case verifies article, price and inventory tables remain byte-for-byte unchanged by reads.

## Delivery boundary

No remote box connection, data/config changes, APK build/install, release promotion, fiscal activation or emission. PR review and a later authorized APK release are still required. On the remote box, success must be checked after that release using normal sync and sales search (e.g. SKU 912); this report does not claim observed recovery there.
