#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMMON_GIT_DIR="$(git -C "${REPO_ROOT}" rev-parse --path-format=absolute --git-common-dir)"
SOURCE_REPO_ROOT="$(dirname "${COMMON_GIT_DIR}")"
WORKSPACE_ROOT="$(dirname "${SOURCE_REPO_ROOT}")"
CANONICAL_BUILD_WORKTREE="${WORKSPACE_ROOT}/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite"
SOURCE_REF="${1:-origin/develop}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "[release-android] $*"
}

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || fail "No existe el archivo requerido: ${path}"
}

extract_version_code_from_metadata() {
  local metadata_file="$1"
  node --input-type=module -e '
    import fs from "node:fs";

    const file = process.argv[1];
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const values = Array.isArray(json?.elements)
      ? json.elements.map(item => Number(item?.versionCode)).filter(Number.isFinite)
      : [];
    console.log(values.length ? Math.max(...values) : 0);
  ' "${metadata_file}"
}

update_gradle_version() {
  local gradle_file="$1"
  local version_code="$2"
  local version_name="$3"

  node --input-type=module -e '
    import fs from "node:fs";

    const [file, code, name] = process.argv.slice(1);
    let source = fs.readFileSync(file, "utf8");
    source = source.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    source = source.replace(/versionName\s+"[^"]+"/, `versionName "${name}"`);
    fs.writeFileSync(file, source);
  ' "${gradle_file}" "${version_code}" "${version_name}"
}

resolve_next_version_code() {
  local gradle_file="$1"
  local max_version
  local metadata_version

  max_version="$(awk '/versionCode[[:space:]]+[0-9]+/ { print $2; exit }' "${gradle_file}")"
  [[ -n "${max_version}" ]] || fail "No pude leer versionCode desde ${gradle_file}"

  while IFS= read -r metadata_file; do
    metadata_version="$(extract_version_code_from_metadata "${metadata_file}")"
    if [[ "${metadata_version}" =~ ^[0-9]+$ ]] && (( metadata_version > max_version )); then
      max_version="${metadata_version}"
    fi
  done < <(find "${WORKSPACE_ROOT}/_worktrees/CLIC-POS" -path '*/android/app/build/outputs/apk/release/output-metadata*.json' -type f 2>/dev/null | sort)

  echo $((max_version + 1))
}

resolve_sdk_dir() {
  local local_properties="$1"
  local sdk_dir

  sdk_dir="$(sed -n 's/^sdk\.dir=//p' "${local_properties}" | tail -n1)"
  [[ -n "${sdk_dir}" ]] || sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  [[ -n "${sdk_dir}" ]] || fail "No pude resolver sdk.dir desde ${local_properties} ni desde ANDROID_SDK_ROOT/ANDROID_HOME"
  [[ -d "${sdk_dir}" ]] || fail "Android SDK no existe en ${sdk_dir}"

  echo "${sdk_dir}"
}

resolve_apksigner() {
  local sdk_dir="$1"
  local build_tools_version
  local apksigner

  build_tools_version="$(ls -1 "${sdk_dir}/build-tools" | sort -V | tail -n1)"
  [[ -n "${build_tools_version}" ]] || fail "No encontré build-tools dentro de ${sdk_dir}"

  apksigner="${sdk_dir}/build-tools/${build_tools_version}/apksigner"
  [[ -x "${apksigner}" ]] || fail "No encontré apksigner ejecutable en ${apksigner}"

  echo "${apksigner}"
}

git -C "${REPO_ROOT}" fetch origin --quiet

SOURCE_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --verify "${SOURCE_REF}")" || fail "No pude resolver el ref fuente: ${SOURCE_REF}"
SOURCE_COMMIT_SHORT="$(git -C "${REPO_ROOT}" rev-parse --short "${SOURCE_COMMIT}")"
SOURCE_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref "${SOURCE_REF}" 2>/dev/null || true)"
[[ -n "${SOURCE_BRANCH}" ]] || SOURCE_BRANCH="${SOURCE_REF}"

[[ -d "${CANONICAL_BUILD_WORKTREE}" ]] || fail "No existe la worktree canónica: ${CANONICAL_BUILD_WORKTREE}"

CANONICAL_STATUS="$(git -C "${CANONICAL_BUILD_WORKTREE}" status --porcelain)"
[[ -z "${CANONICAL_STATUS}" ]] || fail "La worktree canónica no está limpia. Corrige eso antes de compilar."

KEY_PROPERTIES="${CANONICAL_BUILD_WORKTREE}/android/key.properties"
KEYSTORE_FILE="${CANONICAL_BUILD_WORKTREE}/android/keys/clic-pos-release.keystore"
LOCAL_PROPERTIES="${CANONICAL_BUILD_WORKTREE}/android/local.properties"

require_file "${KEY_PROPERTIES}"
require_file "${KEYSTORE_FILE}"
require_file "${LOCAL_PROPERTIES}"

SDK_DIR="$(resolve_sdk_dir "${LOCAL_PROPERTIES}")"
APKSIGNER="$(resolve_apksigner "${SDK_DIR}")"

CANONICAL_GRADLE_FILE="${CANONICAL_BUILD_WORKTREE}/android/app/build.gradle"
require_file "${CANONICAL_GRADLE_FILE}"

NEXT_VERSION_CODE="$(resolve_next_version_code "${CANONICAL_GRADLE_FILE}")"
VERSION_NAME="1.0.${NEXT_VERSION_CODE}"

TEMP_WORKTREE="$(mktemp -d /private/tmp/clicpos-release-XXXXXX)"
cleanup() {
  git -C "${REPO_ROOT}" worktree remove --force "${TEMP_WORKTREE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

info "Fuente del release: ${SOURCE_REF} (${SOURCE_COMMIT_SHORT})"
info "VersionCode siguiente: ${NEXT_VERSION_CODE}"
info "VersionName siguiente: ${VERSION_NAME}"
info "Worktree temporal: ${TEMP_WORKTREE}"

git -C "${REPO_ROOT}" worktree add --detach "${TEMP_WORKTREE}" "${SOURCE_COMMIT}" >/dev/null

if [[ -f "${REPO_ROOT}/.env.local" ]]; then
  cp "${REPO_ROOT}/.env.local" "${TEMP_WORKTREE}/.env.local"
elif [[ -f "${SOURCE_REPO_ROOT}/.env.local" ]]; then
  cp "${SOURCE_REPO_ROOT}/.env.local" "${TEMP_WORKTREE}/.env.local"
elif [[ -f "${REPO_ROOT}/.env" ]]; then
  cp "${REPO_ROOT}/.env" "${TEMP_WORKTREE}/.env"
elif [[ -f "${SOURCE_REPO_ROOT}/.env" ]]; then
  cp "${SOURCE_REPO_ROOT}/.env" "${TEMP_WORKTREE}/.env"
else
  info "No encontré .env.local ni .env en el repo fuente; sigo sin copiar envs."
fi

cp "${KEY_PROPERTIES}" "${TEMP_WORKTREE}/android/key.properties"
mkdir -p "${TEMP_WORKTREE}/android/keys"
cp "${KEYSTORE_FILE}" "${TEMP_WORKTREE}/android/keys/clic-pos-release.keystore"
cp "${LOCAL_PROPERTIES}" "${TEMP_WORKTREE}/android/local.properties"

if [[ ! -e "${TEMP_WORKTREE}/node_modules" ]]; then
  if [[ -d "${REPO_ROOT}/node_modules" ]]; then
    ln -s "${REPO_ROOT}/node_modules" "${TEMP_WORKTREE}/node_modules"
  elif [[ -d "${SOURCE_REPO_ROOT}/node_modules" ]]; then
    ln -s "${SOURCE_REPO_ROOT}/node_modules" "${TEMP_WORKTREE}/node_modules"
  else
    fail "No encontré node_modules ni en ${REPO_ROOT} ni en ${SOURCE_REPO_ROOT}"
  fi
fi

TEMP_GRADLE_FILE="${TEMP_WORKTREE}/android/app/build.gradle"
update_gradle_version "${TEMP_GRADLE_FILE}" "${NEXT_VERSION_CODE}" "${VERSION_NAME}"

info "Ejecutando npm run build"
(cd "${TEMP_WORKTREE}" && npm run build)

info "Ejecutando npx cap sync android"
(cd "${TEMP_WORKTREE}" && npx cap sync android)

info "Ejecutando ./gradlew clean assembleRelease"
(cd "${TEMP_WORKTREE}/android" && ./gradlew clean assembleRelease)

APK_SRC="${TEMP_WORKTREE}/android/app/build/outputs/apk/release/Clic-Pos-${VERSION_NAME}-release.apk"
METADATA_SRC="${TEMP_WORKTREE}/android/app/build/outputs/apk/release/output-metadata.json"

require_file "${APK_SRC}"
require_file "${METADATA_SRC}"

info "Verificando firma"
"${APKSIGNER}" verify --print-certs "${APK_SRC}"

DEST_DIR="${CANONICAL_BUILD_WORKTREE}/android/app/build/outputs/apk/release"
mkdir -p "${DEST_DIR}"

APK_DEST="${DEST_DIR}/Clic-Pos-${VERSION_NAME}-release.apk"
METADATA_DEST="${DEST_DIR}/output-metadata-${VERSION_NAME}.json"
REPORT_DEST="${DEST_DIR}/release-report-${VERSION_NAME}.txt"

cp "${APK_SRC}" "${APK_DEST}"
cp "${METADATA_SRC}" "${METADATA_DEST}"

cat > "${REPORT_DEST}" <<EOF
versionCode=${NEXT_VERSION_CODE}
versionName=${VERSION_NAME}
sourceRef=${SOURCE_REF}
sourceBranch=${SOURCE_BRANCH}
sourceCommit=${SOURCE_COMMIT}
sourceCommitShort=${SOURCE_COMMIT_SHORT}
canonicalBuildWorktree=${CANONICAL_BUILD_WORKTREE}
artifact=${APK_DEST}
metadata=${METADATA_DEST}
builtAt=$(date '+%Y-%m-%d %H:%M:%S %Z')
EOF

info "APK listo"
echo "APK=${APK_DEST}"
echo "METADATA=${METADATA_DEST}"
echo "REPORT=${REPORT_DEST}"
echo "SOURCE_COMMIT=${SOURCE_COMMIT_SHORT}"
echo "VERSION_NAME=${VERSION_NAME}"
