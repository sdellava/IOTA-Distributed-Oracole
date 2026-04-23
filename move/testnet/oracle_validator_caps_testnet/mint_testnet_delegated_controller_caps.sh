#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="${SCRIPT_DIR}/testnet_validator_caps.txt"

GAS_BUDGET="${GAS_BUDGET:-50000000}"
VALIDATOR_SIGNER="${VALIDATOR_SIGNER:-$(iota client active-address 2>/dev/null | tr -d '\n')}"

NODE1_ALIAS="${NODE1_ALIAS:-oracle-node-1}"
NODE2_ALIAS="${NODE2_ALIAS:-oracle-node-2}"
NODE3_ALIAS="${NODE3_ALIAS:-oracle-node-3}"

NODE1_VALIDATOR_CAP_ID="${NODE1_VALIDATOR_CAP_ID:-}"
NODE2_VALIDATOR_CAP_ID="${NODE2_VALIDATOR_CAP_ID:-}"
NODE3_VALIDATOR_CAP_ID="${NODE3_VALIDATOR_CAP_ID:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[error] command not found: $1" >&2
    exit 1
  }
}

package_id_from_report() {
  local report_file="$1"
  [[ -f "$report_file" ]] || return 0

  python3 - "$report_file" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
match = re.search(r'PackageID:\s*(0x[a-fA-F0-9]+)', text)
if match:
    print(match.group(1))
PY
}

resolve_address() {
  local who="$1"
  if [[ "$who" == 0x* ]]; then
    printf '%s\n' "$who"
    return 0
  fi

  local addresses_json
  addresses_json="$(iota client addresses --json 2>/dev/null)"

  local resolved
  resolved="$(
    python3 - "$who" "$addresses_json" <<'PY'
import json
import sys

target = sys.argv[1]
data = json.loads(sys.argv[2])
for entry in data.get("addresses", []):
    if len(entry) >= 2 and entry[0] == target:
        print(entry[1])
        break
PY
  )"

  [[ -n "$resolved" ]] || {
    echo "[error] alias not found in client config: $who" >&2
    exit 1
  }

  printf '%s\n' "$resolved"
}

mint_cap() {
  local recipient_alias="$1"
  local validator_cap_id="$2"
  [[ -n "$validator_cap_id" ]] || return 0

  local recipient_addr
  recipient_addr="$(resolve_address "$recipient_alias")"

  echo "[mint] signer=${VALIDATOR_SIGNER} recipient=${recipient_alias} validator_cap=${validator_cap_id}"
  iota client switch --address "$VALIDATOR_SIGNER" >/dev/null
  iota client ptb \
    --move-call "${VALIDATOR_CAPS_PKG}::validator_caps::mint_delegated_controller_cap" \
      "@${validator_cap_id}" \
      "@${recipient_addr}" \
    --gas-budget "$GAS_BUDGET" \
    --summary
}

require_cmd iota
require_cmd python3

VALIDATOR_CAPS_PKG="${VALIDATOR_CAPS_PKG:-${TESTNET_ORACLE_VALIDATOR_CAPS_PACKAGE_ID:-$(package_id_from_report "$REPORT_FILE")}}"
[[ -n "$VALIDATOR_CAPS_PKG" ]] || { echo "[error] set VALIDATOR_CAPS_PKG or TESTNET_ORACLE_VALIDATOR_CAPS_PACKAGE_ID" >&2; exit 1; }
[[ -n "$NODE1_VALIDATOR_CAP_ID$NODE2_VALIDATOR_CAP_ID$NODE3_VALIDATOR_CAP_ID" ]] || {
  echo "[error] set at least one of NODE1_VALIDATOR_CAP_ID, NODE2_VALIDATOR_CAP_ID, NODE3_VALIDATOR_CAP_ID" >&2
  exit 1
}

echo "[info] env=$(iota client active-env 2>/dev/null | tr -d '\n')"
echo "[info] active-address=$(iota client active-address 2>/dev/null | tr -d '\n')"
echo "[info] VALIDATOR_CAPS_PKG=$VALIDATOR_CAPS_PKG"
echo "[info] VALIDATOR_SIGNER=$VALIDATOR_SIGNER"

mint_cap "$NODE1_ALIAS" "$NODE1_VALIDATOR_CAP_ID"
mint_cap "$NODE2_ALIAS" "$NODE2_VALIDATOR_CAP_ID"
mint_cap "$NODE3_ALIAS" "$NODE3_VALIDATOR_CAP_ID"

echo
echo "[ok] delegated controller caps minted where validator cap ids were provided"
