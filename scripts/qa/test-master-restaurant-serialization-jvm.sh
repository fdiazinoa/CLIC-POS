#!/usr/bin/env bash
set -euo pipefail
: "${CLIC_POS_KOTLIN_COMPILER_CP:?Provide Kotlin compiler classpath}"
: "${CLIC_POS_KOTLIN_STDLIB_JAR:?Provide Kotlin standard library jar}"
: "${CLIC_POS_ANDROID_JAR:?Provide Android platform jar}"
: "${CLIC_POS_JSON_JAR:?Provide functional JVM org.json jar}"
task_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_dir="$(mktemp -d "${TMPDIR:-/tmp}/clic-pos-restaurant-jvm.XXXXXX")"
task_cp="$CLIC_POS_JSON_JAR:$CLIC_POS_ANDROID_JAR:$CLIC_POS_KOTLIN_STDLIB_JAR"
javac -cp "$CLIC_POS_ANDROID_JAR" -d "$task_dir/boundary" \
  "$task_repo_root/tests/fixtures/restaurantContext/Context.java"
java -cp "$CLIC_POS_KOTLIN_COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -no-reflect -classpath "$task_cp" -d "$task_dir/classes" \
  "$task_repo_root/native-stubs/android/ClicPOSMasterHttpServer.kt" \
  "$task_repo_root/native-stubs/android/ClicPOSMasterDiscovery.kt" \
  "$task_repo_root/tests/fixtures/masterRestaurantSerializationHarness.kt"
java -cp "$task_dir/boundary:$task_dir/classes:$task_cp" \
  com.clicpos.nativeprinter.MasterRestaurantSerializationHarnessKt
for task_mutation in cloned-http borrowed-bridge revision-cache; do
  mkdir -p "$task_dir/$task_mutation"
  node "$task_repo_root/scripts/qa/master-restaurant-negative-fixture.mjs" \
    "$task_repo_root/native-stubs/android/ClicPOSMasterHttpServer.kt" \
    "$task_dir/$task_mutation/ClicPOSMasterHttpServer.kt" "$task_mutation"
  java -cp "$CLIC_POS_KOTLIN_COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
    -no-stdlib -no-reflect -classpath "$task_cp" -d "$task_dir/$task_mutation/classes" \
    "$task_dir/$task_mutation/ClicPOSMasterHttpServer.kt" \
    "$task_repo_root/native-stubs/android/ClicPOSMasterDiscovery.kt" \
    "$task_repo_root/tests/fixtures/masterRestaurantSerializationHarness.kt"
  if java -cp "$task_dir/boundary:$task_dir/$task_mutation/classes:$task_cp" \
    com.clicpos.nativeprinter.MasterRestaurantSerializationHarnessKt > "$task_dir/$task_mutation/result.log" 2>&1; then
    printf 'ERROR: negative canary %s incorrectly passed\n' "$task_mutation"; exit 1
  fi
  case "$task_mutation" in
    cloned-http) task_expected='HTTP reintroduced redundant collection stringify/parse' ;;
    borrowed-bridge) task_expected='detached bridge result aliases source' ;;
    revision-cache) task_expected='HTTP and detached builder differ' ;;
  esac
  grep -Fq "$task_expected" "$task_dir/$task_mutation/result.log"
  printf 'PASS: negative canary %s rejected by intended assertion\n' "$task_mutation"
done
if [[ "${1:-}" == --benchmark ]]; then
  mkdir -p "$task_dir/baseline"
  git -C "$task_repo_root" show 16f7c21d6c9eb88bfc9295bb31e7d789fabf102f:native-stubs/android/ClicPOSMasterHttpServer.kt > "$task_dir/baseline/ClicPOSMasterHttpServer.kt"
  java -cp "$CLIC_POS_KOTLIN_COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
    -no-stdlib -no-reflect -classpath "$task_cp" -d "$task_dir/baseline/classes" \
    "$task_dir/baseline/ClicPOSMasterHttpServer.kt" \
    "$task_repo_root/native-stubs/android/ClicPOSMasterDiscovery.kt" \
    "$task_repo_root/tests/fixtures/masterRestaurantSerializationHarness.kt"
  for task_variant in baseline candidate candidate baseline baseline candidate; do
    task_classes="$task_dir/classes"
    if [[ "$task_variant" == baseline ]]; then task_classes="$task_dir/baseline/classes"; fi
    java -Xmx512m -cp "$task_dir/boundary:$task_classes:$task_cp" \
      com.clicpos.nativeprinter.MasterRestaurantSerializationHarnessKt benchmark "$task_variant"
  done
fi
printf 'Restaurant JVM evidence: %s\n' "$task_dir"
