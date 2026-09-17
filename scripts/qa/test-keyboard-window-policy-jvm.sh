#!/usr/bin/env bash
set -euo pipefail
task_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_dir="$(mktemp -d "${TMPDIR:-/tmp}/clic-pos-keyboard-policy-jvm.XXXXXX")"
trap 'rm -r -- "$task_dir"' EXIT
task_javac="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
task_java="${JAVA_HOME:+$JAVA_HOME/bin/}java"
"$task_javac" -d "$task_dir" \
  "$task_repo_root/android/app/src/main/java/com/clicpos/app/PosKeyboardWindowPolicy.java" \
  "$task_repo_root/tests/fixtures/PosKeyboardWindowPolicyHarness.java"
"$task_java" -cp "$task_dir" com.clicpos.app.PosKeyboardWindowPolicyHarness
