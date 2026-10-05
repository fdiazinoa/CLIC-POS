# Independent PLAN AMENDMENT APPROVED — operational candidate artifact safety

Reviewer/session `/root/v3_plan_review`, independent of analyst/developer. Task `v3-operational-pos`; original base `dc92365733b774203d282db23e6306ac05accb2f`; original approval in `plan-review.md`. Review only: no functional code edits, no Gradle execution, no version bump/build/install.

## Evidence and decision

`scripts/release-android.sh` currently knows only `VITE_LARGE_MASTER_SYNC_V3_CANARY` / `CLIC_POS_SIGNED_V3_CANARY`. Its metadata sets canaryNonPromotable from the laboratory flag, and regular metadata/version would misclassify a sales-enabled operational candidate. `android/app/build.gradle` only applies canary opt-in validation/suffix. Promotion currently rejects suffixed version names but lacks explicit operational-candidate metadata rejection.

APPROVED minimal build-safety amendment, within the original candidate-only scope:

1. Add explicit signed operational-candidate opt-in paired with `VITE_LARGE_MASTER_SYNC_V3_CANDIDATE`. Validate each boolean and require exact matching true/false values; reject orphaned opt-in, ambiguous values and simultaneous laboratory CANARY+operational candidate. Reject diagnostic/profile/table-QA combinations analogously to signed laboratory canary.
2. Label the **actual packaged versionName**, expected artifact filename and Android metadata with an unambiguous operational-candidate suffix; verify equality after build. Achieve with minimal declarative Gradle guard/suffix equivalent to canary or an equally verifiable canonical script version path. Direct Gradle must not bypass the paired flag/mode guard. Do not execute Gradle or bump versions now.
3. Report explicit `operationalV3Candidate=true`, `nonpromotable=true`, `salesEnabled=true` for this mode; keep laboratory sales-disabled metadata correct and normal release defaults unchanged. Record paired opt-in, exact source and mode in durable build evidence. Include suffix in next-version parser without lowering/resetting normal version monotonicity.
4. Promotion must explicitly fail closed for operational candidate/nonpromotable evidence as well as reject actual suffixed candidate versions; changing just a metadata versionName to a normal number cannot permit a candidate. Tests cover candidate true, nonpromotable true, inconsistent modes, missing opt-in, malformed boolean, accepted normal V2 and unchanged laboratory metadata. Do not relax golden baseline, required topologies/tests or promotion budgets.
5. Keep clean-source, canonical signed worktree, assets/source/firma/package checks and all independent QA/sync/performance/device gates unchanged. An operational candidate remains unapproved for production regardless of salesEnabled.

This amendment does not authorize APK generation, installation or production promotion. Its implementation joins the frozen candidate diff for full independent code review.
