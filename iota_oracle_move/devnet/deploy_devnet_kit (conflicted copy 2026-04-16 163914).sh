#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM_STATE_DIR="${SCRIPT_DIR}/oracle_system_state_devnet"
TASKS_DIR="${SCRIPT_DIR}/oracle_tasks_devnet"
SCHEDULER_DIR="${SCRIPT_DIR}/iota_task_scheduler_devnet"

SYSTEM_STATE_TXT="${SYSTEM_STATE_DIR}/devnet_system_state.txt"
TASKS_TXT="${TASKS_DIR}/oracle_task_devnet.txt"
SCHEDULER_TXT="${SCHEDULER_DIR}/devnet_scheduler.txt"

TARGET_ENV="${TARGET_ENV:-devnet}"
DEPLOY_ADDRESS="${DEPLOY_ADDRESS:-OID_Groundcontrol}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[error] command not found: $1" >&2
    exit 1
  }
}

extract_package_id() {
  local report_file="$1"
  local pkg_id
  pkg_id="$(
    python3 - "$report_file" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
match = re.search(r'PackageID:\s*(0x[a-fA-F0-9]+)', text)
if match:
    print(match.group(1))
PY
  )"
  pkg_id="$(printf '%s' "$pkg_id" | tr -d '[:space:]')"
  if [[ -z "$pkg_id" ]]; then
    echo "[error] could not extract PackageID from ${report_file}" >&2
    return 1
  fi
  printf '%s\n' "$pkg_id"
}

update_move_toml_identity() {
  local move_toml="$1"
  local address_name="$2"
  local package_id="$3"

  python3 - "$move_toml" "$address_name" "$package_id" <<'PY'
from pathlib import Path
import re
import sys

move_toml = Path(sys.argv[1])
address_name = sys.argv[2]
package_id = sys.argv[3]
text = move_toml.read_text(encoding="utf-8", errors="ignore")

text, count_pub = re.subn(r'(?m)^published-at = ".*"$', f'published-at = "{package_id}"', text, count=1)
if count_pub != 1:
    raise SystemExit(f"failed to update published-at in {move_toml}")

pattern = rf'(?m)^{re.escape(address_name)} = ".*"$'
text, count_addr = re.subn(pattern, f'{address_name} = "{package_id}"', text, count=1)
if count_addr != 1:
    raise SystemExit(f"failed to update address {address_name} in {move_toml}")

move_toml.write_text(text, encoding="utf-8")
PY
}

switch_context() {
  echo "[info] switching env to ${TARGET_ENV}" >&2
  iota client switch --env "${TARGET_ENV}" >&2

  echo "[info] switching address to ${DEPLOY_ADDRESS}" >&2
  iota client switch --address "${DEPLOY_ADDRESS}" >&2
}

publish_package() {
  local package_dir="$1"
  local report_file="$2"
  local address_name="$3"
  local label="$4"
  local result_var="$5"
  local package_id

  echo >&2
  echo "[publish] ${label}" >&2
  echo "[path] ${package_dir}" >&2

  if ! (
    cd "$package_dir"
    iota client publish
  ) >"$report_file" 2>&1; then
    echo "[error] publish failed for ${label}" >&2
    echo "[report] ${report_file}" >&2
    return 1
  fi

  package_id="$(extract_package_id "$report_file")" || {
    echo "[report] ${report_file}" >&2
    return 1
  }

  if [[ -z "$package_id" ]]; then
    echo "[error] empty package id for ${label}" >&2
    echo "[report] ${report_file}" >&2
    return 1
  fi

  update_move_toml_identity "${package_dir}/Move.toml" "$address_name" "$package_id"

  printf -v "$result_var" '%s' "$package_id"

  echo "[ok] ${label} package_id=${package_id}" >&2
  echo "[report] ${report_file}" >&2
}

print_summary() {
  local system_state_pkg="$1"
  local tasks_pkg="$2"
  local scheduler_pkg="$3"

  cat <<EOF

[summary]
  system_state package: ${system_state_pkg}
  tasks package:        ${tasks_pkg}
  scheduler package:    ${scheduler_pkg}

[reports]
  ${SYSTEM_STATE_TXT}
  ${TASKS_TXT}
  ${SCHEDULER_TXT}

[next env values]
  DEVNET_ORACLE_SYSTEM_PACKAGE_ID=${system_state_pkg}
  DEVNET_ORACLE_TASKS_PACKAGE_ID=${tasks_pkg}
  DEVNET_ORACLE_SCHEDULER_PACKAGE_ID=${scheduler_pkg}
EOF
}

require_cmd iota
require_cmd python3

[[ -d "$SYSTEM_STATE_DIR" ]] || { echo "[error] missing dir: $SYSTEM_STATE_DIR" >&2; exit 1; }
[[ -d "$TASKS_DIR" ]] || { echo "[error] missing dir: $TASKS_DIR" >&2; exit 1; }
[[ -d "$SCHEDULER_DIR" ]] || { echo "[error] missing dir: $SCHEDULER_DIR" >&2; exit 1; }

switch_context

echo "[info] active env: $(iota client active-env 2>/dev/null | tr -d '\n')"
echo "[info] active address: $(iota client active-address 2>/dev/null | tr -d '\n')"

SYSTEM_STATE_PKG=""
TASKS_PKG=""
SCHEDULER_PKG=""

publish_package "$SYSTEM_STATE_DIR" "$SYSTEM_STATE_TXT" "iota_oracle_system_state" "system state" SYSTEM_STATE_PKG
publish_package "$TASKS_DIR" "$TASKS_TXT" "iota_oracle_tasks" "oracle tasks" TASKS_PKG
publish_package "$SCHEDULER_DIR" "$SCHEDULER_TXT" "iota_oracle_scheduler" "oracle scheduler" SCHEDULER_PKG

print_summary "$SYSTEM_STATE_PKG" "$TASKS_PKG" "$SCHEDULER_PKG"
