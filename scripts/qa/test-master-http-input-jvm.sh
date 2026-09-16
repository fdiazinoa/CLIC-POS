#!/usr/bin/env bash
set -euo pipefail
: "${CLIC_POS_KOTLIN_COMPILER_CP:?Provide Kotlin compiler classpath}"
: "${CLIC_POS_KOTLIN_STDLIB_JAR:?Provide Kotlin standard library jar}"
: "${CLIC_POS_ANDROID_JAR:?Provide Android platform jar}"
: "${CLIC_POS_JSON_JAR:?Provide JVM org.json jar}"
task_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_dir="$(mktemp -d "${TMPDIR:-/tmp}/clic-pos-http-input-jvm.XXXXXX")"
task_cp="$CLIC_POS_JSON_JAR:$CLIC_POS_ANDROID_JAR:$CLIC_POS_KOTLIN_STDLIB_JAR"
for task_mutation in candidate unbuffered raw-body reader; do
  task_target="$task_dir/$task_mutation"
  mkdir -p "$task_target"
  node "$task_repo_root/scripts/qa/master-http-parser-fixture.mjs" \
    "$task_repo_root/native-stubs/android/ClicPOSMasterHttpServer.kt" "$task_target/ProductionHttpParserFixture.kt" "$task_mutation"
  java -cp "$CLIC_POS_KOTLIN_COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
    -no-stdlib -no-reflect -classpath "$task_cp" -d "$task_target/classes" \
    "$task_repo_root/native-stubs/android/ClicPOSMasterHttpServer.kt" \
    "$task_repo_root/native-stubs/android/ClicPOSMasterDiscovery.kt" \
    "$task_target/ProductionHttpParserFixture.kt" "$task_repo_root/tests/fixtures/masterHttpInputHarness.kt"
  if java -cp "$task_target/classes:$task_cp" com.clicpos.nativeprinter.MasterHttpInputHarnessKt > "$task_target/result.log" 2>&1; then
    if [[ "$task_mutation" != candidate ]]; then
      printf 'ERROR: mutation %s incorrectly passed\n' "$task_mutation"; exit 1
    fi
    cat "$task_target/result.log"
  else
    if [[ "$task_mutation" == candidate ]]; then cat "$task_target/result.log"; exit 1; fi
    grep -Eq 'prefetched/fragmented body lost|headers caused underlying single-byte reads' "$task_target/result.log"
    printf 'PASS: negative canary %s rejected\n' "$task_mutation"
  fi
done
printf 'JVM input evidence: %s\n' "$task_dir"
