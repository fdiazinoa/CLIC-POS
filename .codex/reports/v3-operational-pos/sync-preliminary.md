# SYNC-VALIDATOR preliminary audit — IMPLEMENTING

Task `v3-operational-pos`; independent session `/root/v3_operational_sync`.
Base `dc92365733b774203d282db23e6306ac05accb2f`; candidate SHA not frozen.
Date 2026-10-05. Role delegated by orchestrator, not a native role-selection
claim. No functional writes, device changes, credentials, network prepare,
sales, or APK installation performed by this validator.

Status: PRELIMINARY / PENDING. This report is not SYNC PASS or code/release
approval. Implementation remains in progress; final review follows the frozen
candidate and independent reviewer/QA stages.

Read: AGENTS.md, WORKFLOW.md, .codex/agents/sync-validator.md,
SYNC_ARCHITECTURE.md, OFFLINE_ARCHITECTURE.md, sync/offline checklists,
approved analysis and build-safety amendment. Historical architecture source
SHA is not represented as current runtime evidence.

## Live findings sent to sole developer and root

1. `LargeMasterSyncV3SqliteStore.prepare()` and
   `prepareLargeMasterSyncV3Candidate()` still permit negotiation/staging and
   download after a V3 local ledger movement. The approved plan freezes ALL
   prepare/master/inventory/rollback routes until causal coverage exists.
   Reject at candidate entry before network and at persistence boundaries;
   repeated prepare of the existing runtime must not replace the inventory.
2. Baseline freeze checks should occur inside the mutation transaction as well
   as the common writer fence. Initial concern about separate JS writer locks
   was withdrawn: adapter construction already passes its `withWriteLock` to
   the V3 store. This serializes existing adapter writers but is not proof that
   native/direct writes outside that fence cannot race. Sale commit must
   atomically validate owner/runtime/inventory against its stamp before saving
   the financial documents and deterministic inventory ledger.
3. `BackgroundSyncManager.pruneSyncedItems()` deletes aged30-day synced/APPLIED
   inventory ledger rows. Frozen-baseline stock is derived from those rows;
   deleting them restores stock and eventually removes the freeze. Exempt
   V3-baseline evidence independently of ACK/status/age until explicit causal
   inclusion reconciliation exists.
4. Other destructive paths include SyncManager historical inventory purge,
   terminal-history restore replacing the complete ledger, generic
   `saveCollection('inventoryLedger')`, and `deleteDocument`. Protect evidence
   at the native persistence boundary, not only one cleanup caller. ACK/retry
   updates must retain immutable baseline/IDs/quantities/ownership. Test
   replacement, direct removal, aged ACK and restart.

## Preliminary positive observations (not approvals)

- Build-only candidate flag defaults false; ERP_ACTIVE is required for V3
  read authority. No outbound protocol switch is currently introduced by that
  flag.
- Operational session compares tenant/terminal/device/ERP base/V3 origin with
  persisted owner before offline reuse, and compares token/binding again at
  operation validation. Binding failure is explicit, not legacy fallback.
- Local delta SQL is scoped to baseline key (binding + master + inventory
  version/cursor), article and warehouse, with no sync-status predicate.
  Thus ACK alone does not currently erase the delta at read time. Cleanup
  retention gaps above still prevent approval.
- Activation, rollback, owner replacement and inventory replacement have
  baseline-movement guards in the ongoing diff. Prepare coverage and atomic
  commit integration remain to be reviewed.

## Required frozen-candidate validation

Use controlled test fixtures only until the approved exact candidate APK is
available. Preserve emulator `127.0.0.1:6555` identity and database. Its installed
1.1.480-canary/old schema does not establish operational V3 evidence.

- Baseline8/reserved2/committed1 => available5; atomic sale2 =>3; restart=>3;
  generic ACK/aged ACK=>3; refund1=>4; duplicate completion/retry=>4.
- Concurrency: sale commit racing prepare/activation/inventory replace/rollback
  cannot change baseline under committed delta or silently lose an effect.
- Failed owner/runtime/tariff/inventory validation causes zero payment,
  sequence, document, ledger or outbound mutations.
- Offline current binding reopens; tenant/device/origin/token revocation or
  mismatched owner rejects; no identity repair/rotation/reset as fallback.
- V2 default retains its existing paths; legacy/durable transports remain
  distinct. Missing/receipt/processing ACK must not imply APPLIED_ERP.
- Receiver evidence must prove one business sale, one stock effect, debt/Z
  as relevant, with stable IDs after apply-before-ACK and reconnect. POS local
  tests/HTTP200 alone cannot certify ERP application.

## Explicit ERP blocker

Current productInventory version/cursor/balances has no causal event-inclusion
coverage. Generic APPLIED_ERP is not proof a balance includes a movement. The
candidate must keep the baseline plus all local committed deltas and deny
unrestricted refresh/rollback. Full inventory-refresh parity remains BLOCKED
until ERP returns transactional, scoped, gap-aware coverage and it is tested
against sales/refunds/retry. See `erp-handoff.md`; do not infer this coverage.
