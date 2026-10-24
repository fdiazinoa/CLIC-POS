# V3 operational article selections v1

Additive article authority: `restaurant_contract_version: 1`, `restaurant_inventory_policy: PARENT` and `restaurant_unsupported: false`. The immutable article carries its original `product_type`; COMBO is never coerced to SIMPLE. ERP projection version4 invalidates old simple-only projections. New fiscal envelopes declare `pos_operational_contract_version: "1"`; old unmarked historical receipt validators are unchanged.

| ERP editor source / aliases | V3 article and adapted Product | UI and source validation | Durable / ERP behavior |
|---|---|---|---|
| `metadata.restaurant` / restaurantConfig / restaurant_config; snake/camel aliases | `product_type`, `production_area_id` | Bounded type/route, pinned source guard | Original type/route retained; conflicting aliases rejected |
| `combo_groups` / comboGroups | Active groups/items, IDs, required/min/max, product IDs, source price deltas | Existing ModifierModal; required selections, duplicate/foreign IDs and forged deltas rejected | selected_combo_items + restaurantConfig persisted, retained fingerprint; descriptive combo consumes parent only |
| `modifier_groups` / modifierGroups | Active options, type, affects_price, free_quantity | Existing selector; immutable surcharge/free-quantity calculation | selected_modifiers retained in source and frozen ERP fiscal snapshot |
| `fraction_rule` / fractionRule | Explicit active options, pricing rule, max_parts | Existing equal-part selector and source-derived HIGHEST/AVERAGE/SUM_PARTS/BASE_PLUS_DIFF | Selected IDs, source prices and ratios retained; source-only tests, additional family runtime certification remains required |
| `note_presets` / notePresets | Bounded strings | Existing notes step; selected production note bounded | Note is part of retained identity |
| operationalFlags / operations.allow_negative_stock | Existing V3 ProductOperationalFlags | Existing per-product stock policy | No terminal/global override of article policy |
| variants | Existing active variant dataset + Product.variants | Existing selector and pinned ID/SKU validation | Original variant IDs retained by native checkout; ERP master validation |
| image/category/tax/tariff/routing | Existing independent V3 projections | Existing consumers, renewed read context | No catalog import/recreation or pricing edits |
| recipe/BOM/KIT | Still explicitly unsupported by this selection contract | Requires separately reviewed immutable child/unit/yield/stock contract | Do not strip recipe or pretend parent-only stock is component consumption |
| lots/serials | Still explicitly unsupported | Requires authoritative availability and atomic reservation/uniqueness contract | Do not enable flags by removing rejection |
| weighted variants / nontrivial conversions | Existing explicit weight boundary remains | Requires additional authoritative base/commercial quantity proof | Existing supported kg path preserved |
| formats/presentations | Existing dedicated V2 proof runtime | Existing format/presentation UI | No flattening into restaurant selections |

All tender types are independent of fiscal sequence admission. Configured method, credit/customer, wallet/balance and true gateway authorization remain separate requirements. V1 leases and V2 allocation share native gateway-intent checks. The allocation source compares exact tender IDs and total/pending credit algebra. New workflow source transports runtime types unchanged. No new account mapping or wallet/advance ledger proof is invented by the selection contract.

Functional contracts: `tests/v3RestaurantSelection.test.ts`, `tests/offlineFiscalLease.test.ts`, `tests/offlineFiscalAllocation.test.ts`, and mirrored ERP projection/workflow tests. This matrix records implemented and explicitly unsupported boundaries; it is not a claim that every family is production-certified. No performance campaign is part of this change.
