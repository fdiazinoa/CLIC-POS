# V3 operational POS — independent QA preparation

Role/session: QA `/root/v3_operational_qa`; task `v3-operational-pos`. Date: 2026-10-05. Base HEAD inspected: `dc92365733b774203d282db23e6306ac05accb2f`. Worktree: `/Users/felixdiaz/.codex/worktrees/v3-canary-routing/CLIC-POS`, branch `feature/sync-v3-operational-pos`. Functional files are being edited by the sole developer. There is **no frozen reviewed candidate yet**. Status: **PREPARATION COMPLETED; candidate QA PENDING**. No functional changes, dependency installation, build, installation, sale, payment, refund, closure, reset or device restart performed by this session.

## Instructions and environment

Read `.codex/agents/qa.md`, `AGENTS.md`, `WORKFLOW.md`, the eight required architecture maps, analysis/approved plan, functional/regression/sales/payments/tickets/tables/offline/release checklists, APK checklist/protocol/constitution, and APK installation skill. Explicit delegated independent role; native client role selection is not assumed. Historical architecture snapshots are not deployed/device certifications.

Read-only commands observed Node `v24.11.1`, npm `11.6.2`, an executable installed `node_modules/.bin/tsx`, and ADB `/Users/felixdiaz/Library/Android/sdk/platform-tools/adb`. Workflow CI requires Node 22; the final validation runner must document Node 22 or explicitly record environment discrepancy. No `npm ci` while developer shares checkout. Candidate workflow gate requires tracked code clean and HEAD equal reviewed candidate SHA.

Orchestrator later resolved an isolated Node22 runner through the normal npm cache: `npx --yes --package=node@22 node --version` observed `v22.23.3`. Final commands may use `npx --yes --package=node@22 -c 'node ...'` to prepend that runtime without modifying checkout dependencies; record the actual runner/version with final evidence.

## Device readiness observed (not operational QA PASS)

`install_clic_pos_apk.sh list` returned exactly one authorized `device`: serial `127.0.0.1:6555`, product/device `motion_phone_arm64`, model `Pixel_C`. `getprop ro.kernel.qemu` returned `1`. `dumpsys package com.clicpos.app` returned versionCode `1480`, versionName `1.1.480-canary`, minSdk24/targetSdk36. `pidof com.clicpos.app` returned `4405`. `/proc/net/unix` exposed `@webview_devtools_remote_4405`. `adb forward --list` was empty. No new forwarding was created. These facts demonstrate transport/process/debug readiness only: identity, SQLite ownership, binding, catalog counts, UI readiness, fiscal capability, receipt peripherals, queues and ERP business effects were **not inspected or certified**.

## Existing coverage versus required new coverage

Existing `largeMasterSyncV3*.test.ts` cover receiver/atomic chunks/checksums/version and inventory fences; bound transport identity; opt-in dark candidate; operational article mapping and pure checkout authority. `salePostedContract`, payment fractions, refund persistence, close preparation and the workflow transverse groups cover selected legacy/durable logic. None alone proves V3 UI-to-payment-to-local-to-ERP-to-Z E2E.

New implementation tests must establish:

1. Default-off V2 unchanged; explicit operational candidate separate from nonoperative canary; emulator/binding/ownership checks before online work and offline snapshot reuse, including binding change in flight.
2. Exact native ID/SKU/barcode identity beyond top60 substring search; <=60 visible query limit; stale async responses cannot replace latest; cart cache retained and duplicate scans suppressed; no full catalog React/localStorage hydration or legacy catalog fallback.
3. Mixed/legacy/stale/tariff/warehouse/unknown-tax rejection **before** gateway/payment intent, partial-payment saves, NCF and sequence changes; spy on writes to prove zero side effects; binding revalidation/immutable payment fence through App commit.
4. Included/excluded/exempt/multiple/zero/18% rates, discounts and rounding; frozen fiscal reconciliation with no legacy config or 18% fallback, before sequence allocation.
5. Native atomic transaction/history/ledger commit and stable sale-ID/cart-component movement IDs; failure rollback and repeat completion cannot duplicate documents, ledger, debt, payment or NCF. All refund/alternate commit entry paths included.
6. Scoped persisted inventory overlay: baseline8-reserved2-committed1=5, sale2=>3, restart=>3, ERP ACK=>3, refund1=>4; exact binding/baseline/warehouse isolation; SERVICE/noninventoriable zero movement; missing stock rejected unless existing explicit allow-negative policy. All activation/rollback/replace paths must deny refresh after local movements absent causal inclusion coverage.
7. Unsupported KIT/recipe/tracking/modifier/reservation/scale semantics visibly fail, not silent PRODUCT fallback or V2 data borrow. Full V2 parity remains a separate open acceptance requirement.

## Execution plan after frozen REVIEW PASS

Receive exact reviewed SHA/manifest from orchestrator. Reconfirm HEAD/diff cleanliness and classify committed diff with workflow plan. Execute required workflow QA suites with external log, V3-specific/new tests and `npm run test:catalog-sync`; preserve command/version/count/failure logs and hashes. Build/typecheck/lint/prebuild evidence must match exact source and be recorded by the responsible gate; preexisting failures still block, not waived.

Independent runtime checklist on exact approved APK is required after build/install approval: preserve identity/config/history via install-r; search/scan/cart/quantity/discount/totals; cash and authorized sandbox methods/payment fractions/credit policy; persisted one sale/payment/fiscal identity/history/ledger; receipt and distinct reprint; actual ERP business document/ledger comparison; offline sale and restart/reconnect without duplicates; refund/void policy; Z membership/history/retry; cold restart. Capture expected/observed IDs/counts/totals/logs without tokens/PINs. No screen-open or HTTP200-only approval. Sync validator independently owns bidirectional sync/order/idempotence. Performance follows functional QA, with matched datasets/flags and n/p50/p95/p99/max.

Restaurant/tables/multi-terminal, recipes/variants/tracking/reservations, physical peripherals and golden three-topology promotion are required where applicable. Missing environment/contracts remain BLOCKED, never inferred PASS. Current zero inventory is not permission to fabricate balances or enable negative stock. No destructive setup or sales during preimplementation baseline.

## Release limits

This report authorizes no APK build/install/promotion and grants no QA PASS. Conservative frozen-baseline simple PRODUCT/SERVICE candidate is not unrestricted inventory-refresh or full V2 parity approval. Final candidate QA will be a separate SHA-bound report after independent code REVIEW PASS.
