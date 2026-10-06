# PLAN APPROVED — pos-terminal-fiscal-sku
Approver: /root, orchestrator/plan-approver; independent from /root/fiscal_sku_analyst.
Base: f904f83543b387b60ca4b82ea9f0be8bdda31e01.
Approved analysis: /tmp/pos-terminal-fiscal-sku-analysis.md.

Implement centralized managed-terminal fiscal authority, fail closed for absent/disabled/revoked credit-note allocation before financial side effects, preserve explicit legacy standalone/NONE/E34/prepared ERP behavior and monotonic local counters. Fix supermarket SKU/reference precedence and legibility/header labels, retaining monetary calculations and edits. No ERP/operational database writes, schema changes, APK build/install or merge.

One developer owns functional files. Independent reviewer then QA, sync-validator and performance; release/internal-deploy report scope limits without attempting APK/deployment. Start after QA baseline capture completes. Required missing runtime evidence remains BLOCKED; use draft PR if code release gate cannot be satisfied. Approval of concrete plan by coordinator does not approve implementation or release. Generic delegated sessions are used; native registered role selection is unavailable.
