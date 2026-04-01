#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
GAS_BUDGET="${GAS_BUDGET:-50000000}"
CONTROLLER_ADDRESS_OR_ALIAS="${CONTROLLER_ADDRESS_OR_ALIAS:-}"
SYSTEM_PKG="${SYSTEM_PKG:-${ORACLE_SYSTEM_PACKAGE_ID:-}}"
STATE_ID="${STATE_ID:-${ORACLE_STATE_ID:-}}"
CLOCK_ID="${CLOCK_ID:-0x6}"

usage() {
  cat <<'EOF'
Close expired pending template proposals on-chain.

Usage:
  ./scripts/close_expired_template_proposals.sh [--env-file ./.env] [--controller <addr_or_alias>]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --env-file" >&2; usage; exit 1; }
      ENV_FILE="$1"
      ;;
    --controller)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --controller" >&2; usage; exit 1; }
      CONTROLLER_ADDRESS_OR_ALIAS="$1"
      ;;
    --gas-budget)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --gas-budget" >&2; usage; exit 1; }
      GAS_BUDGET="$1"
      ;;
    --system-pkg)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --system-pkg" >&2; usage; exit 1; }
      SYSTEM_PKG="$1"
      ;;
    --state-id)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --state-id" >&2; usage; exit 1; }
      STATE_ID="$1"
      ;;
    --clock-id)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --clock-id" >&2; usage; exit 1; }
      CLOCK_ID="$1"
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
  set -a
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$ENV_FILE")
  set +a
fi

NETWORK_RAW="$(echo "${IOTA_NETWORK:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
case "$NETWORK_RAW" in
  dev|local|localnet) NETWORK_RAW="devnet" ;;
  test) NETWORK_RAW="testnet" ;;
  main) NETWORK_RAW="mainnet" ;;
esac
NET_PREFIX="$(echo "$NETWORK_RAW" | tr '[:lower:]' '[:upper:]')"

get_prefixed_env() {
  local key="$1"
  local v=""
  if [[ -n "$NET_PREFIX" ]]; then
    local p="${NET_PREFIX}_${key}"
    v="${!p:-}"
  fi
  if [[ -n "$v" ]]; then
    printf "%s" "$v"
    return 0
  fi
  printf "%s" "${!key:-}"
}

SYSTEM_PKG="${SYSTEM_PKG:-$(get_prefixed_env ORACLE_SYSTEM_PACKAGE_ID)}"
STATE_ID="${STATE_ID:-$(get_prefixed_env ORACLE_STATE_ID)}"
CLOCK_ID="${CLOCK_ID:-$(get_prefixed_env IOTA_CLOCK_ID)}"
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(get_prefixed_env CONTROLLER_ADDRESS_OR_ALIAS)"
fi
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(get_prefixed_env ORACLE_CONTROLLER_ADDRESS)"
fi
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(iota client active-address 2>/dev/null | tr -d '\r' | xargs || true)"
fi

[[ -n "$SYSTEM_PKG" ]] || { echo "[error] missing SYSTEM_PKG / ORACLE_SYSTEM_PACKAGE_ID" >&2; exit 1; }
[[ -n "$STATE_ID" ]] || { echo "[error] missing STATE_ID / ORACLE_STATE_ID" >&2; exit 1; }
[[ -n "$CONTROLLER_ADDRESS_OR_ALIAS" ]] || { echo "[error] missing controller address/alias" >&2; exit 1; }

iota client switch --address "$CONTROLLER_ADDRESS_OR_ALIAS" >/dev/null
iota client ptb \
  --move-call "${SYSTEM_PKG}::systemState::close_expired_task_template_proposal" \
  "@${STATE_ID}" \
  "@${CLOCK_ID}" \
  --gas-budget "$GAS_BUDGET"

echo "[ok] close_expired_task_template_proposal executed."
