# Disposable native fiscal laboratory

This debug application is **com.clicpos.fiscalqa**, version0.0.1-laboratory. It never installs/replaces com.clicpos.app, starts App/bootstrap, copies operational data, issues documents or authenticates to ERP. Its merged manifest must have **no INTERNET** permission. Release Gradle tasks are rejected. All sources/identities/claims/config/DBs are synthetic in its own Android UID. The fixed adapter DB name `clic_pos_native` is therefore a different sandbox from the operational package. No keystore/release/cap-sync command is used.

The bundle imports the actual candidate CapacitorSQLiteAdapter/schema/Session/financial writer/constructor/receipt validation/dispatcher and dynamically loads the actual installed Capacitor community SQLite plugin. Dependency ports supply synthetic config/identity/session, disabled networking and only sqlite_outbox_v2=true; all other flags, formats, recovery and background sync stay false. The Session uses its actual class and methods with a synthetic preseeded cache constructor (bypassing only operational open/build activation, not session validation). The local fiscal authority port is synthetic/no-op; the native typed commit validators remain real. Simulated transport throws a lost ACK and never makes HTTP requests. The script is not a replacement provider or ERP10scenario suite.

From a **clean frozen checkout**, Node22:

```
node qa/fiscal-native/build-bundle.mjs /tmp/clic-pos-fiscalqa-assets
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home ANDROID_HOME=/Users/felixdiaz/Library/Android/sdk ./android/gradlew -p qa/fiscal-native/android -PfiscalQaAssetsDir=/tmp/clic-pos-fiscalqa-assets -PfiscalQaBuildDir=/tmp/clic-pos-fiscalqa-gradle assembleDebug
```

Build/install only after independent source/runner review and root's lab authorization. Asset manifest records exact source SHA, bundle hash, dependency graph, synthetic ports and native SQLite plugin file hashes. QA must additionally pin APK hash/package/signature/merged permissions and explicit lab serial. Product release build is a different gate. Do not run Gradle in the operational Android app project or install on an unselected target.

Default run seeds100 synthetic old documents **before** the real adapter opens/migrates. It verifies preservation, quick_check, actual installed indexes/triggers; real CASH Date→constructor ISO→financial native commit→same-source/durable replay; actual typed receipt claims on separate SQLite plugin DBs, precommit write fault rollback and postcommit ACK loss/ambiguous simulated transport. It emits `FISCAL_QA_RESULT`/DOM title `READY_FOR_PROCESS_RESTART`. QA then force-stops and reopens **only this lab package**, proving native process persistence and same-source GET-only claim protection; final title `NATIVE_FUNCTIONAL_COMPLETED`. No `pm clear`, production package stop/reset/uninstall or DB copying. DB names fiscal_qa_claim/fiscal_qa_claim_ackloss are lab-owned.

Performance is explicit and separate, only after functional QA and exclusive root handoff. From the laboratory WebView DevTools:

```
await fiscalQA.runPerformance({mode:'base',session:1,n:100,seedRows:10000})
await fiscalQA.runPerformance({mode:'candidate',session:1,n:100,seedRows:10000})
```

Alternate mode order for sessions2/3. Each command creates a new own DB; existing DB causes refusal, never reset. Both populate10k original synthetic rows first,17.5KB-ish payload (exact bytes reported). Baseline explicitly lacks the three new lookup indexes; candidate creates the actual three indexes on the populated DB. Only these disposable fixture DBs drop indexes before seeding. Captures migration,105 individual inserts/read lookups and actual constructor+financial commits (first5 warmups,100 retained raw samples), query plans, row/ledger/events and quick_check invariants. Counts include105 transactions/history/ledger and exactly210 new SALE/PAYMENT events. Six populated DBs can consume over1GB; ensure lab disk space first. Bridge-inclusive WebView performance.now is not UI input latency or physical POS performance. Do not trim tails or treat this as a hardware release budget approval.

Web bundle target is Chrome83, with no new silent financial polyfill. Actual runtime Android/WebView/SQLite and unsupported API failures are reported. Current dedicated lab AVD is emulator-5580/API33/WebView103; it does not certify the older operational WebView83. Native logs/APK/source hashes and review/QA/sync/performance remain separate evidence and gates.

All Gradle project outputs are redirected outside source by fiscalQaBuildDir (absolute, default/tmp/clic-pos-fiscalqa-gradle), with unique root/app/plugin subdirectories. Preserve failed intermediate builds externally; ESLint continues to inspect runner source without generated bundles contaminating repository checks. APK is under fiscalQaBuildDir/app/outputs/apk/debug/.

## Explicit online Android ↔ ERP laboratory

This separately selected build preserves the offline entry above. It alone enables INTERNET and mixed content (`--online` and matching `-PfiscalQaOnline=true`). Android network security permits cleartext only for127.0.0.1; the laboratory fetch driver allows only the exact18765origin and five documented paths. No App/bootstrap, product sync transport, public catalog, acceptance GET, credentials outside the synthetic handoff, or production assertReady activation is imported. No operational app installation, data copy, stop, settings or pairing is involved. The same harness UID retains its prior offline databases; each online session creates a unique `fiscal_online_<timestamp>` SQLite database and refuses a second session/partial-phase retry. Startup performs only runtime/HTTP preflight, no financial writes.

From a reviewed, clean source SHA:

```
node qa/fiscal-native/build-bundle.mjs /tmp/clic-pos-fiscalqa-online-assets --online --lab-input=/tmp/erp-fiscal-android-lab-1017c
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home ANDROID_HOME=/Users/felixdiaz/Library/Android/sdk ./android/gradlew -p qa/fiscal-native/android -PfiscalQaOnline=true -PfiscalQaAssetsDir=/tmp/clic-pos-fiscalqa-online-assets -PfiscalQaBuildDir=/tmp/clic-pos-fiscalqa-online-gradle assembleDebug
```

Build-time inputs are connection.json/catalog-input.json plus only master fiscal bounds/IDs/expiry/issuer from source-example.json; no original, event, checksum, receipt or expected READY is bundled. Two initial buffer numbers derive from the authorized synthetic master allocation start, distinct from preloaded control. The native adapter's real reserveFinancialNumbers validates/CASes authority and writes immutable nativeFiscalReservations; snapshotFiscalIssuance and a laboratory guard validate the consumed buffer/config/range. The operational utils/db reserve wrapper/lock is deliberately not imported and is not certified by this test. SQLite schema, catalog adapter/runtime/session, constructor, financial commit/serializers, receipt network validator and dispatcher/CAS are real. Config/identity and catalog seeds are synthetic laboratory ports, not full ERP bootstrap. Only sqlite_outbox_v2 is enabled inside the pre-existing synthetic port; product flags and all formats remain untouched.

After independently verifying APK/package/SHA/device/tunnel/FAKEservice, QA invokes from the laboratory WebView DevTools:

```
await fiscalOnlineQA.preflight() // own runtime fingerprint + actual health/metrics; no operation
await fiscalOnlineQA.start() // exactly2newCASH sources, SALE→PAYMENT inbox per source, real receipt and one ISSUE each
```

`ONLINE_READY_FOR_PROCESS_RESTART` exports session IDs, original rows/hashes, claims, counters, sequences and quick_check. For source2 the driver awaits and consumes the actual ISSUE response before deliberately throwing `LAB_INJECTED_ACK_LOST_AFTER_REAL_RESPONSE`; only that acknowledgement loss is simulated. FAKEprovider counter must increase exactly2. force-stop/start **only com.clicpos.fiscalqa**, then:

```
await fiscalOnlineQA.recover() // reopen, original durable claims, zero further HTTP/POST during dispatch replay
await fiscalOnlineQA.snapshot()
fiscalOnlineQA.report()
```

Recovered financial commit replay uses the original constructor output and must add no ledger/sequences/Outbox; full durable hashes stay fixed. Provider counter must remain unchanged. Any partial phase is HOLD with no auto-transport/retry/reserve or reset. PENDING/APPLIED/FAKE never proves DGII acceptance. This laboratory does not validate product UI performance, sandbox MSeller, printer, negative E34, historical post-Z or connect product assertReady. Do not replace fixtures with claims of real endpoints: online entry uses actual window.fetch throughout and records every allowed request/body SHA without headers.
