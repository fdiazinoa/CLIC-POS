# Duarte_01 — observation and ERP handoff

Independent analyst `/root/v3_operational_analysis`, 2026-10-05. Read-only ADB SQLite (`sqlite3 -readonly`), serial `127.0.0.1:6555`, installed candidate reported by orchestrator 1.1.480-canary/code1480. No data/identity changes, no credentials emitted.

## Observed local evidence

- Active snapshot version9: 53,875 articles, all active and normalized article_type=PRODUCT; uom NULL for all.
- Historical table total269,375 = five snapshots, not current catalog count.
- Six active tariff IDs: GENERAL/Tarifa Duarte `9bfbcfaf-1594-42d5-8c91-0b22c58dde6d`, MAYORISTA/Mayorista Duarte `9a9716a4-805d-427a-a1bb-b371a7c25ec5`, plus tariffs Santiago/Villa Mella.
- Installed old schema has no record_json, contract_version, tariff taxIncluded, warehouse or operational-flag columns. It cannot prove original article semantics or current stock policy. Every row normalized PRODUCT is not proof the raw ERP has no kits/recipes/tracking.
- documents has config1/roles3/users3; config document only id/timestamp/version. No available terminal inventoryScope/default tariff/allowNegative policy in that document. No products/customers/transactions/ledger documents observed.
- Do not infer current authorized device identity from old screenshot or historical snapshot; fresh bound contract2 session required before sales.

## Prompt to paste into ERP thread

We are connecting the operational Large Master Sync V3 candidate to the existing Duarte_01 emulator. Preserve its authorized device identity, pairing and tokens. V2 production must remain unchanged. Do not reset data or alter stock/negative-stock policy to make a test pass.

Please verify current deployed contract2 data for exactly the bound Duarte_01 tenant/terminal/device, and report nonsecret aggregate evidence:

1. Article type distribution and advanced semantics actually present: PRODUCT/SERVICE/KIT/RECETA, recipeDetails/batchYield/kitInventoryMode, tracking lots/serials, weighted/PLU, modifiers, variant tariff pricing, units/conversions and cost. The installed old contract1 normalized all53,875 articles as PRODUCT and omitted raw data, so it cannot certify parity. Export the semantics required by existing POS behavior; never silently map unsupported type to PRODUCT. If absent in this tenant, show aggregate counts0 rather than assuming.
2. Effective tariff ID and taxIncluded, exact active warehouse IDs per article, terminal defaultSalesWarehouseId, stockTracking and allowNegativeStock policy. Clarify explicit semantics of empty activeWarehouseIds: no warehouse authorization vs unrestricted, and ensure the client applies that contract exactly. Inventory currently reported0 rows; do not manufacture balances.
3. Add an additive causal-inclusion contract to productInventory. Existing response version/cursor/balances is insufficient to reconcile POS offline sales after ERP acknowledgement. APPLIED_ERP does not prove a particular inventory snapshot includes a local movement. We need a scoped, monotonic inclusion watermark or exact stable movement/event IDs included in that snapshot, with tenant/terminal/device/warehouse ownership and transactional consistency between balances and coverage. Specify whether a watermark covers all prior sequence numbers or can have gaps; a highest ID without prefix completeness is unsafe. Include signed refund/reversal/damaged-return and partial/split-sale semantics. Duplicate movement IDs must be applied once.
4. Confirm outbound existing sale/inventory paths apply one business document and one stock effect per stable ID, including retry after apply-before-ACK. Do not switch POS outbound protocol merely because master download is V3. Return observed document IDs/status and inclusion coverage without token/customer details.

Acceptance example: snapshot onHand8/reserved2/committed1 -> available5; offline sell2 -> local3; generic ACK keeps local3; later snapshot proving inclusion of that exact sale movement preserves3 (not1 or5); refund1 ->4; snapshot that does not yet include sale retains required local delta. Restart and duplicate retry preserve these balances. Coverage for one terminal must never clear another terminal's movement.

Until coverage is implemented, POS candidate conservatively pins the initial inventory snapshot and overlays all committed local movements without clearing on ACK; it must block snapshot replacement/rollback after local movements rather than double deduct or lose stock. That permits a bounded demo sale cycle but is not production-equivalent inventory refresh. Please implement and validate the additive ERP contract through the usual ERP PR/deploy workflow, report commit/schema migration/canary evidence, and provide the exact response schema for POS integration. No production release approval is implied.
