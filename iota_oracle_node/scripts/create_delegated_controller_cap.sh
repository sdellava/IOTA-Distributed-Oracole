#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
NETWORK=""
VALIDATOR_ADDRESS=""
NODE_ADDRESS=""
VALIDATOR_CAP_ID=""
DELEGATED_PACKAGE="${DELEGATED_PACKAGE:-${VALIDATOR_CAPS_PKG:-}}"
GAS_BUDGET="${GAS_BUDGET:-50000000}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Create a DelegatedControllerCap for a node address.

Interactive flow:
  1) asks network (devnet|testnet|mainnet)
  2) asks validator address (tx sender / cap owner)
  3) asks node address (recipient)
  4) switches iota env + validator address
  4) calls validator_caps::mint_delegated_controller_cap

Usage:
  ./scripts/create_delegated_controller_cap.sh [options]

Options:
  --network <name>            devnet|testnet|mainnet
  --validator-address <0x...> validator owner address (used for switch)
  --node-address <0x...>      recipient address for the delegated cap
  --validator-cap-id <id>     optional UnverifiedValidatorOperationCap object id
  --delegated-package <id>    delegated controller cap package id (default from .env)
  --system-pkg <id>           deprecated alias for --delegated-package
  --gas-budget <u64>          gas budget (default: 50000000)
  --dry-run                   build/simulate tx without executing
  --env-file <path>           env file (default: ./ .env)
  -h, --help                  show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --network" >&2; usage; exit 1; }
      NETWORK="$1"
      ;;
    --node-address)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --node-address" >&2; usage; exit 1; }
      NODE_ADDRESS="$1"
      ;;
    --validator-address)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --validator-address" >&2; usage; exit 1; }
      VALIDATOR_ADDRESS="$1"
      ;;
    --validator-cap-id)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --validator-cap-id" >&2; usage; exit 1; }
      VALIDATOR_CAP_ID="$1"
      ;;
    --delegated-package|--validator-caps-pkg)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --delegated-package" >&2; usage; exit 1; }
      DELEGATED_PACKAGE="$1"
      ;;
    --system-pkg)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --system-pkg" >&2; usage; exit 1; }
      DELEGATED_PACKAGE="$1"
      ;;
    --gas-budget)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --gas-budget" >&2; usage; exit 1; }
      GAS_BUDGET="$1"
      ;;
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --env-file" >&2; usage; exit 1; }
      ENV_FILE="$1"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[error] unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "$ENV_FILE" && -f "${PROJECT_DIR}/.env" ]]; then
  ENV_FILE="${PROJECT_DIR}/.env"
fi
if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "[error] env file not found: $ENV_FILE" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$ENV_FILE")
  set +a
fi

normalize_network() {
  local n
  n="$(echo "$1" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$n" in
    dev|local|localnet) echo "devnet" ;;
    test) echo "testnet" ;;
    main) echo "mainnet" ;;
    *) echo "$n" ;;
  esac
}

get_prefixed_env() {
  local key="$1"
  if [[ -n "${NET_PREFIX:-}" ]]; then
    local prefixed="${NET_PREFIX}_${key}"
    local pv="${!prefixed:-}"
    if [[ -n "$pv" ]]; then
      printf "%s" "$pv"
      return 0
    fi
  fi
  printf "%s" "${!key:-}"
}

command -v iota >/dev/null 2>&1 || { echo "[error] iota CLI not found" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[error] node not found" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[error] python3 not found" >&2; exit 1; }

if [[ -z "$NETWORK" ]]; then
  read -r -p "Network (devnet|testnet|mainnet): " NETWORK
fi
NETWORK="$(normalize_network "$NETWORK")"
[[ "$NETWORK" == "devnet" || "$NETWORK" == "testnet" || "$NETWORK" == "mainnet" ]] || {
  echo "[error] invalid network: $NETWORK" >&2
  exit 1
}

if [[ -z "$VALIDATOR_ADDRESS" ]]; then
  read -r -p "Validator address (0x...): " VALIDATOR_ADDRESS
fi
[[ "$VALIDATOR_ADDRESS" =~ ^0x[0-9a-fA-F]+$ ]] || { echo "[error] invalid validator address: $VALIDATOR_ADDRESS" >&2; exit 1; }
VALIDATOR_ADDRESS="$(echo "$VALIDATOR_ADDRESS" | tr '[:upper:]' '[:lower:]')"

if [[ -z "$NODE_ADDRESS" ]]; then
  read -r -p "Node address (0x...): " NODE_ADDRESS
fi
[[ "$NODE_ADDRESS" =~ ^0x[0-9a-fA-F]+$ ]] || { echo "[error] invalid node address: $NODE_ADDRESS" >&2; exit 1; }
NODE_ADDRESS="$(echo "$NODE_ADDRESS" | tr '[:upper:]' '[:lower:]')"

NET_PREFIX="$(echo "$NETWORK" | tr '[:lower:]' '[:upper:]')"
if [[ -z "$DELEGATED_PACKAGE" ]]; then
  DELEGATED_PACKAGE="$(get_prefixed_env ORACLE_VALIDATOR_CAPS_PACKAGE_ID)"
fi
[[ -n "$DELEGATED_PACKAGE" ]] || { echo "[error] missing ORACLE_VALIDATOR_CAPS_PACKAGE_ID (or --delegated-package)" >&2; exit 1; }
[[ "$GAS_BUDGET" =~ ^[0-9]+$ ]] || { echo "[error] --gas-budget must be numeric" >&2; exit 1; }

echo "[info] project: $PROJECT_DIR"
echo "[info] network: $NETWORK"
echo "[info] validator address: $VALIDATOR_ADDRESS"
echo "[info] recipient node address: $NODE_ADDRESS"
echo "[info] delegated package: $DELEGATED_PACKAGE"

echo "[info] switching env..."
iota client switch --env "$NETWORK" >/dev/null
echo "[info] switching active address to validator..."
iota client switch --address "$VALIDATOR_ADDRESS" >/dev/null

if [[ -z "$VALIDATOR_CAP_ID" ]]; then
  echo "[info] discovering UnverifiedValidatorOperationCap on validator address..."
  mapfile -t CANDIDATE_CAPS < <(
    iota client objects --json | node -e '
      const fs = require("fs");
      const arr = JSON.parse(fs.readFileSync(0, "utf8"));
      for (const e of (Array.isArray(arr) ? arr : [])) {
        const d = e?.data ?? e;
        const t = String(d?.type ?? "");
        const id = String(d?.objectId ?? "");
        if (!id) continue;
        if (t.endsWith("::iota_system::UnverifiedValidatorOperationCap")) {
          process.stdout.write(id + "\n");
        }
      }
    '
  )

  if [[ ${#CANDIDATE_CAPS[@]} -eq 0 ]]; then
    echo "[warn] no UnverifiedValidatorOperationCap found among owned objects; trying validator metadata..."
    META_CAP_ID="$(
      iota validator display-metadata "$VALIDATOR_ADDRESS" 2>/dev/null \
        | sed -n 's/^[[:space:]]*operationCapId:[[:space:]]*"\(0x[0-9a-fA-F]\+\)".*/\1/p' \
        | head -n1
    )"
    if [[ -n "$META_CAP_ID" ]]; then
      VALIDATOR_CAP_ID="$META_CAP_ID"
      echo "[info] found operationCapId from metadata: $VALIDATOR_CAP_ID"
    else
      echo "[error] unable to discover validator cap id for ${VALIDATOR_ADDRESS}" >&2
      echo "[hint] pass --validator-cap-id <id> explicitly (for your validator it's likely operationCapId)." >&2
      exit 1
    fi
  fi

  if [[ -z "$VALIDATOR_CAP_ID" && ${#CANDIDATE_CAPS[@]} -eq 1 ]]; then
    VALIDATOR_CAP_ID="${CANDIDATE_CAPS[0]}"
  elif [[ -z "$VALIDATOR_CAP_ID" ]]; then
    echo "Found multiple validator caps. Select one:"
    for i in "${!CANDIDATE_CAPS[@]}"; do
      printf "  %2d) %s\n" "$((i+1))" "${CANDIDATE_CAPS[$i]}"
    done
    read -r -p "> " PICK
    [[ "$PICK" =~ ^[0-9]+$ ]] || { echo "[error] invalid selection" >&2; exit 1; }
    IDX=$((PICK - 1))
    (( IDX >= 0 && IDX < ${#CANDIDATE_CAPS[@]} )) || { echo "[error] selection out of range" >&2; exit 1; }
    VALIDATOR_CAP_ID="${CANDIDATE_CAPS[$IDX]}"
  fi
fi

[[ "$VALIDATOR_CAP_ID" =~ ^0x[0-9a-fA-F]+$ ]] || { echo "[error] invalid validator cap id: $VALIDATOR_CAP_ID" >&2; exit 1; }
VALIDATOR_CAP_ID="$(echo "$VALIDATOR_CAP_ID" | tr '[:upper:]' '[:lower:]')"

echo "[info] validator cap id: $VALIDATOR_CAP_ID"
echo "[info] creating delegated controller cap..."

upsert_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"

  [[ -n "$env_file" && -f "$env_file" ]] || return 0

  python3 - "$env_file" "$key" "$value" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
text = path.read_text(encoding="utf-8", errors="ignore")
lines = text.splitlines()
pattern = re.compile(rf"^{re.escape(key)}=.*$")
new_line = f"{key}={value}"

for idx, line in enumerate(lines):
    if pattern.match(line):
        lines[idx] = new_line
        break
else:
    lines.append(new_line)

path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

run_mint_call() {
  local recipient_arg="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    iota client call \
      --package "$DELEGATED_PACKAGE" \
      --module validator_caps \
      --function mint_delegated_controller_cap \
      --args "$VALIDATOR_CAP_ID" "$recipient_arg" \
      --gas-budget "$GAS_BUDGET" \
      --dry-run
  else
    iota client call \
      --package "$DELEGATED_PACKAGE" \
      --module validator_caps \
      --function mint_delegated_controller_cap \
      --args "$VALIDATOR_CAP_ID" "$recipient_arg" \
      --gas-budget "$GAS_BUDGET"
  fi
}

MINT_OUTPUT=""
if ! MINT_OUTPUT="$(run_mint_call "$NODE_ADDRESS" 2>&1)"; then
  echo "$MINT_OUTPUT"
  echo "[warn] iota client call with plain node address failed, retrying with quoted address..."
  MINT_OUTPUT="$(run_mint_call "\"${NODE_ADDRESS}\"" 2>&1)"
fi
echo "$MINT_OUTPUT"

echo ""
echo "[ok] delegated cap mint transaction submitted."

DELEGATED_CAP_ID="$(
  python3 - "$DELEGATED_PACKAGE" "$MINT_OUTPUT" <<'PY'
import re
import sys

delegated_package = sys.argv[1]
text = sys.argv[2]
pattern = re.compile(
    r"ObjectID:\s*(0x[a-fA-F0-9]+).*?ObjectType:\s*"
    + re.escape(delegated_package)
    + r"::validator_caps::DelegatedControllerCap",
    re.S,
)
match = pattern.search(text)
if match:
    print(match.group(1))
PY
)"

[[ -n "$DELEGATED_CAP_ID" ]] || {
  echo "[error] could not determine delegated cap id from transaction output" >&2
  exit 1
}

CAP_OBJECT_JSON="$(iota client object "$DELEGATED_CAP_ID" --json 2>/dev/null || true)"
CAP_OWNER=""
if [[ -n "$CAP_OBJECT_JSON" ]]; then
  CAP_OWNER="$(
    python3 - "$CAP_OBJECT_JSON" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
owner = data.get("owner", {})
if isinstance(owner, dict):
    print(owner.get("AddressOwner", ""))
PY
  )"
fi

if [[ -n "$CAP_OWNER" ]]; then
  [[ "$CAP_OWNER" == "$NODE_ADDRESS" ]] || {
    echo "[error] delegated cap owner mismatch: expected ${NODE_ADDRESS}, found ${CAP_OWNER}" >&2
    exit 1
  }
  echo "[info] delegated cap owner verified: ${CAP_OWNER}"
else
  echo "[warn] could not verify delegated cap owner via object lookup; continuing because mint transaction succeeded"
fi

echo "Latest candidate DELEGATED_CONTROLLER_CAP_ID=${DELEGATED_CAP_ID}"

if [[ "$DRY_RUN" -eq 0 && -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  upsert_env_value "$ENV_FILE" "DELEGATED_CONTROLLER_CAP_ID" "$DELEGATED_CAP_ID"
  echo "[updated] ${ENV_FILE}"
fi
