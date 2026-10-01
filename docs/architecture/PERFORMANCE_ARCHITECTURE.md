# Performance architecture

## Baseline protocol

Store baselines by device/runtime and scenario, never by one hard-coded model:

```text
performance-baselines/<device-profile>/<scenario>.json
```

Each record must include task, commit, timestamp, app version, runtime/browser/WebView version, OS, hardware/device id or anonymized profile, dataset size, warm/cold mode, sample count and raw durations. Baseline and candidate must use the same profile and scenario with at least 30 samples unless a documented protocol requires more.

Report p50, p95, p99 and max. Also capture JS long tasks over 50 ms, style recalculation/layout, forced synchronous layout, React commit/render counts, blocking storage, GC pressure, critical network path, WebView stalls and CPU saturation when tooling permits. A lower average does not compensate for a p95/p99 regression.

The general interaction target is p95 ≤ 50 ms where the measurement represents an interaction that can technically meet it. Network/device workflows need scenario-specific budgets.

## High-risk paths

- `App.tsx` and `POSInterface.tsx` are large state/effect hubs with broad render and lifecycle blast radius.
- Vite manual chunks exist, but the baseline has no lazy component loading boundary.
- Android `saveDocument` rewrites whole JSON collections, so latency scales with collection size.
- startup/deferred transaction history, product catalog rendering, table map calculations and sync batch apply need dataset-scaled measurements.
- repeated sync initialization can accumulate online/offline listeners.

## Current status

No benchmark, trace collector, Lighthouse budget, React profiler automation or device baseline existed on audited `main`. Therefore `PERFORMANCE_GATE` is `BLOCKED`, not `PASS`, for changes that require it until raw comparable evidence is captured. The capability contract is in `dev-harness/capabilities/registry.json`.

