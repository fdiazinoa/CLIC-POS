#!/usr/bin/env bash
set -euo pipefail

# Dependencies are supplied explicitly; this test never downloads or builds an APK.
: "${CLIC_POS_KOTLIN_COMPILER_CP:?Provide the Kotlin compiler and its dependencies classpath}"
: "${CLIC_POS_KOTLIN_STDLIB_JAR:?Provide the Kotlin standard library jar}"
: "${CLIC_POS_ANDROID_JAR:?Provide an Android SDK platform android.jar}"
: "${CLIC_POS_JSON_JAR:?Provide a JVM org.json jar (not Android method stubs)}"

task_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_test_dir="$(mktemp -d "${TMPDIR:-/tmp}/clic-pos-master-setup-jvm.XXXXXX")"
task_compile_cp="$CLIC_POS_JSON_JAR:$CLIC_POS_ANDROID_JAR:$CLIC_POS_KOTLIN_STDLIB_JAR"

java -cp "$CLIC_POS_KOTLIN_COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -no-reflect -classpath "$task_compile_cp" -d "$task_test_dir/classes" \
  "$task_repo_root/native-stubs/android/ClicPOSMasterHttpServer.kt" \
  "$task_repo_root/native-stubs/android/ClicPOSMasterDiscovery.kt" \
  "$task_repo_root/tests/fixtures/masterSetupDirectoryHarness.kt"

java -cp "$task_test_dir/classes:$task_compile_cp" \
  com.clicpos.nativeprinter.MasterSetupDirectoryHarnessKt
printf 'JVM test classes: %s\n' "$task_test_dir/classes"
