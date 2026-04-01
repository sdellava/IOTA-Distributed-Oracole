#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
NETWORK=""
EXAMPLES_DIR=""

usage() {
  cat <<'EOF'
Interactive template proposer from JSON examples.
Loads .env, lists JSON files under examples, asks which ones to propose.

Usage:
  ./scripts/propose_templates_interactive.sh [--network devnet|testnet|mainnet] [--env-file /path/.env] [--examples-dir /path/examples]

Examples:
  ./scripts/propose_templates_interactive.sh
  ./scripts/propose_templates_interactive.sh --network devnet
  ./scripts/propose_templates_interactive.sh --network testnet --env-file ./../.env
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --env-file" >&2; usage; exit 1; }
      ENV_FILE="$1"
      ;;
    --network)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --network" >&2; usage; exit 1; }
      NETWORK="$1"
      ;;
    --examples-dir)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --examples-dir" >&2; usage; exit 1; }
      EXAMPLES_DIR="$1"
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
PROPOSER_SCRIPT="${SCRIPT_DIR}/propose_template_from_json.sh"

[[ -f "$PROPOSER_SCRIPT" ]] || { echo "[error] proposer script not found: $PROPOSER_SCRIPT" >&2; exit 1; }

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "${PROJECT_DIR}/.env" ]]; then
    ENV_FILE="${PROJECT_DIR}/.env"
  else
    echo "[error] .env not found under ${PROJECT_DIR}. Use --env-file." >&2
    exit 1
  fi
fi
[[ -f "$ENV_FILE" ]] || { echo "[error] env file not found: $ENV_FILE" >&2; exit 1; }

if [[ -z "$EXAMPLES_DIR" ]]; then
  EXAMPLES_DIR="${PROJECT_DIR}/src/tasks/examples"
fi
[[ -d "$EXAMPLES_DIR" ]] || { echo "[error] examples dir not found: $EXAMPLES_DIR" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source <(sed 's/\r$//' "$ENV_FILE")
set +a

if [[ -z "$NETWORK" ]]; then
  NETWORK="${IOTA_NETWORK:-}"
fi
NETWORK="$(echo "${NETWORK}" | tr '[:upper:]' '[:lower:]' | xargs)"
case "$NETWORK" in
  dev|local|localnet) NETWORK="devnet" ;;
  test) NETWORK="testnet" ;;
  main) NETWORK="mainnet" ;;
esac
[[ "$NETWORK" == "devnet" || "$NETWORK" == "testnet" || "$NETWORK" == "mainnet" ]] || {
  echo "[error] invalid or missing network. Use --network devnet|testnet|mainnet or set IOTA_NETWORK in .env" >&2
  exit 1
}

NET_PREFIX="$(echo "$NETWORK" | tr '[:lower:]' '[:upper:]')"

get_prefixed_env() {
  local key="$1"
  local prefixed="${NET_PREFIX}_${key}"
  local v="${!prefixed:-}"
  if [[ -n "$v" ]]; then
    printf "%s" "$v"
    return 0
  fi
  printf "%s" "${!key:-}"
}

SYSTEM_PKG="$(get_prefixed_env ORACLE_SYSTEM_PACKAGE_ID)"
STATE_ID="$(get_prefixed_env ORACLE_STATE_ID)"
CLOCK_ID="$(get_prefixed_env IOTA_CLOCK_ID)"
CONTROLLER_CAP_ID="$(get_prefixed_env CONTROLLER_CAP_ID)"
CONTROLLER_ADDRESS_OR_ALIAS="$(get_prefixed_env CONTROLLER_ADDRESS_OR_ALIAS)"
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(get_prefixed_env ORACLE_CONTROLLER_ADDRESS)"
fi

if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(iota client active-address | tr -d '\r' | xargs)"
fi

[[ -n "$SYSTEM_PKG" ]] || { echo "[error] missing ${NET_PREFIX}_ORACLE_SYSTEM_PACKAGE_ID (or ORACLE_SYSTEM_PACKAGE_ID) in env" >&2; exit 1; }
[[ -n "$STATE_ID" ]] || { echo "[error] missing ${NET_PREFIX}_ORACLE_STATE_ID (or ORACLE_STATE_ID) in env" >&2; exit 1; }
[[ -n "$CONTROLLER_CAP_ID" ]] || { echo "[error] missing ${NET_PREFIX}_CONTROLLER_CAP_ID (or CONTROLLER_CAP_ID) in env" >&2; exit 1; }
[[ -n "$CONTROLLER_ADDRESS_OR_ALIAS" ]] || { echo "[error] missing controller address/alias in env and active-address unavailable" >&2; exit 1; }

mapfile -t JSON_FILES < <(find "$EXAMPLES_DIR" -maxdepth 1 -type f -name '*.json' | sort)
[[ ${#JSON_FILES[@]} -gt 0 ]] || { echo "[error] no json files found in $EXAMPLES_DIR" >&2; exit 1; }

echo "[info] env-file=${ENV_FILE}"
echo "[info] network=${NETWORK}"
echo "[info] system_pkg=${SYSTEM_PKG}"
echo "[info] state_id=${STATE_ID}"
echo "[info] controller=${CONTROLLER_ADDRESS_OR_ALIAS}"
echo "[info] controller_cap_id=${CONTROLLER_CAP_ID}"
echo "[info] examples_dir=${EXAMPLES_DIR}"
echo ""
echo "Available templates:"
for i in "${!JSON_FILES[@]}"; do
  printf "  %2d) %s\n" "$((i + 1))" "$(basename "${JSON_FILES[$i]}")"
done
echo ""
echo "Select templates to propose:"
echo "  - type numbers separated by space/comma (example: 1 3 5)"
echo "  - or type 'all'"
read -r -p "> " SELECTION

SELECTION="$(echo "$SELECTION" | tr '[:upper:]' '[:lower:]' | xargs)"
[[ -n "$SELECTION" ]] || { echo "[error] empty selection" >&2; exit 1; }

SELECTED_FILES=()
if [[ "$SELECTION" == "all" ]]; then
  SELECTED_FILES=("${JSON_FILES[@]}")
else
  NORMALIZED="$(echo "$SELECTION" | tr ',' ' ')"
  declare -A seen=()
  for token in $NORMALIZED; do
    [[ "$token" =~ ^[0-9]+$ ]] || { echo "[error] invalid token: $token" >&2; exit 1; }
    idx=$((token - 1))
    (( idx >= 0 && idx < ${#JSON_FILES[@]} )) || { echo "[error] index out of range: $token" >&2; exit 1; }
    if [[ -z "${seen[$idx]:-}" ]]; then
      SELECTED_FILES+=("${JSON_FILES[$idx]}")
      seen[$idx]=1
    fi
  done
fi

[[ ${#SELECTED_FILES[@]} -gt 0 ]] || { echo "[error] no templates selected" >&2; exit 1; }

echo ""
echo "[info] proposing ${#SELECTED_FILES[@]} template(s)..."
for file in "${SELECTED_FILES[@]}"; do
  echo ""
  echo "============================================================"
  echo "[propose] $(basename "$file")"
  echo "============================================================"
  bash "$PROPOSER_SCRIPT" \
    --file "$file" \
    --env-file "$ENV_FILE" \
    --controller "$CONTROLLER_ADDRESS_OR_ALIAS" \
    --system-pkg "$SYSTEM_PKG" \
    --state-id "$STATE_ID" \
    --controller-cap-id "$CONTROLLER_CAP_ID" \
    ${CLOCK_ID:+--clock-id "$CLOCK_ID"}
done

echo ""
echo "[ok] done. proposals submitted."
