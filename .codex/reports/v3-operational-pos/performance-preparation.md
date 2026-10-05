# V3 operational POS — independent PERFORMANCE preparation

Role/session: PERFORMANCE `/root/v3_operational_performance`; task `v3-operational-pos`; date 2026-10-05. Base inspected `dc92365733b774203d282db23e6306ac05accb2f`. Candidate SHA: **not frozen**. Worktree `feature/sync-v3-operational-pos` is being edited by its sole developer. This report is preparation and source-risk analysis, **not PERFORMANCE PASS or APK approval**. No benchmarks, device changes, sales, reset/GC, build or profiling were executed.

Read role, AGENTS, WORKFLOW, PERFORMANCE_ARCHITECTURE, SELECTIVE, performance checklist, approved task analysis and amendment, APK checklist/protocol and other architecture maps. Historical source inventory was consulted for affected modules, not treated as runtime evidence. Native client role selection is not assumed; this is an independently delegated session.

## Gate disposition and baseline gap

- Functional REVIEW/QA has not passed a frozen candidate: performance execution remains PENDING.
- QA independently observed emulator `127.0.0.1:6555`, `Pixel_C`, Android emulator flag 1, installed APK `1.1.480-canary`/1480. This report did not independently mutate or measure it.
- The installed laboratory APK disables normal POS sales. Its contract1 snapshot is not an operational V2 baseline for cart/payment/receipt/inventory/outbox/Z, nor a valid candidate contract2 runtime. Download timing from that lab may be a separately labeled protocol observation, never a complete-cycle baseline.
- A reviewed operational baseline APK, its exact SHA/hash/flags and comparable preserved dataset have not been supplied. Rebuilding historical APKs, downgrading/uninstalling this device, changing pairing or clearing SQLite is not an acceptable workaround. Existing production V2 measurements on different hardware/data cannot be claimed as matched results.
- A safe future comparison can use an already existing verified operational V2 artifact on a separately authorized matched test emulator with equivalent scoped data/config, or existing valid raw captures matching the intended setup. Neither environment/data equivalence nor authority to create that setup is currently established. Web/host mock comparisons are exploratory and cannot replace Android/WebView evidence.
- Therefore release PERFORMANCE gate is **BLOCKED** by missing frozen QA-approved candidate and matched operational baseline. One final candidate APK constraint remains intact; no extra exploratory APK build is proposed. If device performance is a mandatory prebuild gate, that dependency is unresolved: a host benchmark cannot silently authorize the first APK.

## Static implementation risks (hypotheses, not measured regressions)

The in-progress source at inspection had bounded visible native search of 60 articles, batched prices, but per-product balance and variant queries plus per-product ledger overlay queries. A full result could generate more than 180 bridge queries; `Promise.all` limits returned rows but does not eliminate native bridge serialization or cancel stale work. Latest-response sequence fencing correctly protects visible state but must be paired with avoiding redundant work where practical.

Substring `instr(lower(sku/description), query)` cannot use the ordinary SKU index for substring search; misses/rare queries can scan all 53,875 rows although return rows are bounded. Category filtering uses an optional OR predicate. Exact barcode has a scoped index; variant exact code needs its own version/code index. Scoped inventory overlay JSON predicates are semantically correct but, without an expression index, can scan the entire inventoryLedger once per result. Frozen code must be checked with representative SQL EXPLAIN/query counts; host timings must be labeled host/native-SQL surrogate, not device UI timings.

`LargeMasterSyncV3OperationalPOS` depended on the whole `props.config` reference to reopen/project the catalog and reset cache. Cart effect loaded all unique cart IDs on every cart-array change, including quantity edits. These may induce repeated native reads/remount work. Verify stable selectors/reference preservation, bounded cache including retained cart IDs, and no rebuild of 53,875 products or 323,097 prices in React/localStorage.

Existing POS search debounce is 175ms. Report textbox echo/interactivity, query dispatch→results, and original user input→results independently. Do not relabel the last boundary or subtract debounce to claim <=50ms full search. End-to-end results cannot satisfy that threshold while the inherited delay remains. Do not add arbitrary loaders/delays or disable sync to hide work.

Developer acknowledged risks and is adding batch balances/variants/deltas and scoped indexes before freeze. Those edits are not yet independently reviewed or verified; this report confers no approval on them.

## Measurement protocol after functional QA

Record immutable baseline/candidate SHA, APK hash/package/version, Android/WebView versions, CPU/emulator settings, orientation, keyboard/input method, roles/terminal/config/flags, representative scoped article/price/history counts, inventory baseline and local overlay counts, network state and running sync policy. V2 versus V3 authority flag is the deliberate independent variable; other differences must be listed rather than described as identical. No unauthorized identity changes.

Use >=100 valid samples per operation/mode across >=3 independent sessions, with documented warmup and cold starts reported separately, per `.codex/checklists/performance.md`. The analyst's n>=30 minimum is exploratory only, not a checklist PASS. Calculate nearest-rank sorted[ceil(q*n)-1] at q=.50/.95/.99, n/p50/p95/p99/max, absolute delta and percent delta. Preserve outliers unless a documented capture error invalidates them. Investigate >5% or >5ms regression; confirmed regression fails. General interactive p95<=50ms and legacy navigation500ms are distinct thresholds.

Operations include actual opening POS, common/rare/missing text queries, category selection, exact barcode/SKU/id and native/camera/Enter/retail paths, variant choice where supported, add/remove/quantity/edit/discount/tax recompute, restored/parked cart, payment opening/confirmation, receipt/reprint, history/Tickets, Z and relevant Mesas navigation. Full existing cycle parity is required: benchmark success cannot excuse missing recipes/tracking/reservation/restaurant contracts. Unsupported functional paths stay explicit QA/release blockers, not omitted scenarios treated as PASS.

For every operation separate input→first visible, input→interactive and handler duration from native read wait, durable financial commit, payment-provider wait, physical print and outbound ERP application. Measure UI blockage during external waits too. Run idle, active-sync and reconnect cases with the same policies, plus cold/warm modes. Sales that change baseline stock/history require a repeatable authorized equivalent dataset plan; never reset production/demo history or freeze/discard movements to manufacture equal samples.

Follow SELECTIVE, no renderer profiling/fiber traversal. Existing physical-device serial examples do not authorize that device here: target only the authorized emulator. Retain raw traces, aligned clocks/uncertainty, drops and observer configuration. Normal release, diagnostic control and Zone/observer-enabled modes are distinct; disable() does not remove Zone. Validate observer overhead against matched workload and reject causal attribution if overhead exceeds5% or drops occur. Double-rAF FIRST_RENDER is not a presented frame; use FrameTimeline/system trace correlation. V8 stack sample weight is not exact function duration.

Inspect Long Tasks>50ms, forced layout/getBoundingClientRect, native bridge stalls, React render/cache rebuilds, sync storage/JSON/GC, periodic timers, network critical path and scheduling. Missing trace categories cannot prove absence. No foreground profiling, force-stop, network changes, checkout or heap-GC before QA/device authorization and absence of pending business operations.

## Handoff

Risks sent directly to developer and orchestrator. Next input required: frozen REVIEW/QA-approved SHA and exact operational baseline/raw capture/environment plan. Then perform independent bounded SQL/query-count review and valid measurements if the environment exists. Until then: **PREPARATION COMPLETED; PERFORMANCE PENDING/BLOCKED; no runtime values or approval fabricated**.
