#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
NETWORK=""
VALIDATOR_ADDRESS=""
NODE_ADDRESS=""
VALIDATOR_CAP_ID=""
SYSTEM_PKG="${SYSTEM_PKG:-}"
GAS_BUDGET="${GAS_BUDGET:-50000000}"

usage() {
  cat <<'EOF'
Create a DelegatedControllerCap for a node address.

Interactive flow:
  1) asks network (devnet|testnet|mainnet)
  2) asks validator address (tx sender / cap owner)
  3) asks node address (recipient)
  4) switches iota env + validator address
  4) calls systemState::mint_delegated_controller_cap

Usage:
  ./scripts/create_delegated_controller_cap.sh [options]

Options:
  --network <name>            devnet|testnet|mainnet
  --validator-address <0x...> validator owner address (used for switch)
  --node-address <0x...>      recipient address for the delegated cap
  --validator-cap-id <id>     optional UnverifiedValidatorOperationCap object id
  --system-pkg <id>           optional system package id (default from .env)
  --gas-budget <u64>          gas budget (default: 50000000)
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
    --system-pkg)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --system-pkg" >&2; usage; exit 1; }
      SYSTEM_PKG="$1"
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
if [[ -z "$SYSTEM_PKG" ]]; then
  SYSTEM_PKG="$(get_prefixed_env ORACLE_SYSTEM_PACKAGE_ID)"
fi
[[ -n "$SYSTEM_PKG" ]] || { echo "[error] missing ORACLE_SYSTEM_PACKAGE_ID (or --system-pkg)" >&2; exit 1; }
[[ "$GAS_BUDGET" =~ ^[0-9]+$ ]] || { echo "[error] --gas-budget must be numeric" >&2; exit 1; }

echo "[info] project: $PROJECT_DIR"
echo "[info] network: $NETWORK"
echo "[info] validator address: $VALIDATOR_ADDRESS"
echo "[info] recipient node address: $NODE_ADDRESS"
echo "[info] system package: $SYSTEM_PKG"

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

run_mint_with_recipient() {
  local recipient_arg="$1"
  iota client ptb \
    --move-call "${SYSTEM_PKG}::systemState::mint_delegated_controller_cap" "@${VALIDATOR_CAP_ID}" "$recipient_arg" \
    --gas-budget "$GAS_BUDGET"
}

if ! run_mint_with_recipient "$NODE_ADDRESS"; then
  echo "[warn] PTB recipient format '$NODE_ADDRESS' failed, retrying with typed address..."
  if ! run_mint_with_recipient "address:${NODE_ADDRESS}"; then
    echo "[warn] typed format failed, retrying with '@' address literal..."
    run_mint_with_recipient "@${NODE_ADDRESS}"
  fi
fi

echo ""
echo "[ok] delegated cap mint transaction submitted."
echo "[info] switching active address to node to list delegated caps..."
iota client switch --address "$NODE_ADDRESS" >/dev/null
echo "[info] delegated caps now owned by ${NODE_ADDRESS}:"
iota client objects --json | node -e "
  const fs = require('fs');
  const typeTarget = '${SYSTEM_PKG}::systemState::DelegatedControllerCap';
  const arr = JSON.parse(fs.readFileSync(0, 'utf8'));
  const caps = [];
  for (const e of (Array.isArray(arr) ? arr : [])) {
    const d = e?.data ?? e;
    if (String(d?.type ?? '') === typeTarget) {
      caps.push({ id: String(d?.objectId ?? ''), version: Number(d?.version ?? 0) });
    }
  }
  caps.sort((a, b) => b.version - a.version);
  if (!caps.length) {
    console.log('  (none found)');
    process.exit(0);
  }
  for (const c of caps) console.log('  - ' + c.id + ' (version=' + c.version + ')');
  console.log('');
  console.log('Latest candidate DELEGATED_CONTROLLER_CAP_ID=' + caps[0].id);
"
