# APK and internal deployment pipeline

## What exists

- `npm run android:apk:release` runs web build, Capacitor sync and Gradle `assembleRelease`.
- `android/app/build.gradle` supplies `versionCode`, `versionName`, output filename and conditional signing.
- `services/version/posApkUpdateService.ts` consumes `GET /api/pos-apk/latest` and expects metadata including version code, URLs and optionally checksum/changelog.

What does not exist in audited `main`: a fail-closed signed release script, CI/CD, signature/checksum report, Cloud-Admin upload/publish/delete implementation, storage/bucket definition, rollback API or verified permissions/cache behavior. Internal deployment is therefore `BLOCKED` until the owning Cloud-Admin repository/API contract is supplied and audited.

## Approved APK sequence

1. Confirm every required task gate is `PASS` or independently justified `NOT_REQUIRED`.
2. Confirm clean approved commit and correct ancestry from `main`.
3. In the authorized signed-build worktree, confirm `versionCode` is monotonic and version sources/policy agree.
4. Fail if signing configuration/keystore is unavailable; do not accept an unsigned release artifact.
5. Run the real build for that exact commit.
6. Identify the APK by the expected Gradle output/metadata, never by newest timestamp.
7. Verify APK signature with the Android build-tools `apksigner` resolved explicitly from the SDK.
8. Extract/verify package, `versionName` and `versionCode` with Android tooling; calculate SHA-256.
9. Record task, commit, versions, file, checksum, signature identity and all gate results.
10. Only then set `APPROVED_FOR_INTERNAL_TESTING`.

The harness `inspect-apk` command requires an explicit Android SDK `aapt` path and extracts package/version metadata from the APK itself, plus SHA-256. It is not signature verification and cannot by itself pass `BUILD_GATE`. After a real gated build, `register-apk` requires explicit `aapt` and `apksigner` paths, requires recognizable successful verifier output, records only a hash/size of that output, and binds the APK to a clean checkout at the sealed candidate commit.

```bash
npm run harness -- register-apk --task POS-YYYY-NNNN --file android/app/build/outputs/apk/release/<file>.apk --aapt /absolute/sdk/build-tools/<version>/aapt --apksigner /absolute/sdk/build-tools/<version>/apksigner --actor <assigned-release-agent>
```

## Safe Cloud-Admin publication

After the real API/storage contract is known and a human authorizes internal publication:

```text
approved explicit APK record
→ upload versioned object (for example clic-pos-<versionName>.apk)
→ verify stored size/checksum/metadata
→ atomically publish/update the “latest” pointer
→ verify Cloud-Admin UI metadata
→ download through the public/internal consumer URL
→ verify downloaded SHA-256 equals approved artifact
→ retain prior version/pointer for rollback
→ optionally clean older, non-current versions after authorization
```

Never delete the current APK before the replacement is uploaded and verified. A partial failure sets `DEPLOY_FAILED`/`BLOCKED`, retains evidence and restores the previous publication pointer when the API supports it. Do not log tokens, signed URLs with credentials, passwords or storage secrets.

Use `dev-harness/templates/internal-deploy-report.md`. `INTERNAL_TESTING_PASSED` and `APPROVED_FOR_PRODUCTION` are later states; production promotion requires a separate explicit human approval.

## Rollback

Rollback selects the previously recorded immutable artifact by checksum/version, verifies it still exists, atomically restores its publication pointer and verifies download checksum. Rollback never means rebuilding “the same version” from a moving branch.
