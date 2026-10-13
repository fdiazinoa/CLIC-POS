# MYKON empty V3 inventory coverage recovery

Base origin/develop29fb51f, user expressly authorized develop on2026-10-13. Branchfix/sync-v3-inventory-coverage. Functionalcommitb32cf57823e69f97ab7ad6bf6f8857b8a19ca8d0. Writer /root/mykon_inventory_coverage_audit; plan/evaluation /root/erp_inventory_fiscal_reviewer; separate QA /root/pos_coverage_qa. Principal dirty/conflicted preserved, signed worktree untouched.

## Observed problem and approved scope
MYKON129 V3 delivers3010 tracked/negative-stock-allowed articles but scoped ERP inventory response is empty; native adapt excludes them without balance coverage. Native operating database not directly inspected. Normal V3 catalog refresh retains inventory anchor, so server correction alone cannot recover it.
Recover only completely empty UNUSED authority during explicit refresh. Healthy baseline no network request; missing coverage in partial/used baseline requires migration and is never overwritten. Bound ERP data projected to current catalog/authorized warehouse, numbers/duplicates validated, whole coverage required. BEGINIMMEDIATE/nativewriteLock protects binding/owner/anchor/receipt/retainedsources/ledger checks; any drift or halfwrite rolls back. No business-data clear/reset or delta relabeling. Config APPLIED only after committed native coverage/readback; failures preserve pending command/checkpoint.

## Evidence and gates
Independent reviewed exactmanifest507d6d980d1d646989f11537f035fb0258a72b3ea59b6dc59fb1ac3a2a5065c2 and all6functionalfile hashes; ratifiedfunctionalcommitb32cf57. G2/G3 localPASS; reviewer-host124testsPASS, fullwebbuildPASS4.63s, lint0errors39existingwarnings. Real fixtureSQLiteclose/reopen, all3010catalogrows, newcatalogN410/oldanchorS309 to exactcurrentreceiptN→N, negativecheckoutpermission/no transactionwrites, failure/retry/no prematureAPPLIED.
Separate QA full workflow251tests and focused94testsPASS; external all3010SKU reopen verification underway at documentation time. Exact final evidence /Users/felixdiaz/.codex/reports/mykon-global-coverage/pos-independent-qa.md.
G6 physicalAndroid/B2BsyncBLOCKED until ERPPR2238 deployed and signedAPKupdated. G7 AndroidperformanceBLOCKED; hostdatabasefixtures do not prove physical latency. G8 releaseBLOCKED; draftPR only. No APK built/installed fromthisbranch and no live sale/payment/fiscalissue/close created.

## Dependency / rollback
ERPPRhttps://github.com/fdiazinoa/CLIC-ERP/pull/2238 must provide explicit authoritative zero balances and invalidateoldemptycollection caches. Install only verified signedcandidate afterprotected source integration and requiredreleasegates. Test ordinarysync129 then restart/search3010products/price/taxes/permissions; failure stayspending rather thanAPPLIED. Rollback code through protectedrevertPR, never delete localfinancialdata or downgrade operationalAPK. No automatic repair of used/partially coveredbaselines approved.
