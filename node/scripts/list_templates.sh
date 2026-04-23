#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

SHOW_PENDING=0
PENDING_ONLY=0
JSON_OUTPUT=0
NETWORK=""
ENV_FILE=""

usage() {
  cat <<'EOF'
List approved templates for the oracle state.
Optionally include the active pending proposal with current approvals.

Usage:
  ./scripts/list_templates.sh [--network devnet|testnet|mainnet] [--env-file /path/.env] [--pending] [--pending-only] [--json]

Options:
  --network      Force network for env resolution (devnet|testnet|mainnet)
  --env-file     Env file to load before reading network/object IDs
  --pending       Show approved templates and pending proposal (if any)
  --pending-only  Show only pending proposal details
  --json          Print machine-readable JSON output
  -h, --help      Show this help

Examples:
  ./scripts/list_templates.sh
  ./scripts/list_templates.sh --network testnet
  ./scripts/list_templates.sh --network testnet --env-file ./../.env
  ./scripts/list_templates.sh --pending
  ./scripts/list_templates.sh --pending-only
  ./scripts/list_templates.sh --pending --json
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pending)
      SHOW_PENDING=1
      ;;
    --pending-only)
      PENDING_ONLY=1
      ;;
    --json)
      JSON_OUTPUT=1
      ;;
    --network)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --network" >&2; usage; exit 1; }
      NETWORK="$1"
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

if [[ "${SHOW_PENDING}" -eq 1 && "${PENDING_ONLY}" -eq 1 ]]; then
  echo "[error] use either --pending or --pending-only, not both" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "$ENV_FILE" && -f "${PROJECT_DIR}/.env" ]]; then
  ENV_FILE="${PROJECT_DIR}/.env"
fi
if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "[error] env file not found: $ENV_FILE" >&2; exit 1; }
  for k in \
    DEVNET_IOTA_RPC_URL DEVNET_IOTA_RPC_URLS DEVNET_IOTA_CLOCK_ID DEVNET_ORACLE_TASKS_PACKAGE_ID DEVNET_ORACLE_SYSTEM_PACKAGE_ID DEVNET_ORACLE_STATE_ID DEVNET_CONTROLLER_CAP_ID DEVNET_CONTROLLER_ADDRESS_OR_ALIAS DEVNET_ORACLE_CONTROLLER_ADDRESS \
    TESTNET_IOTA_RPC_URL TESTNET_IOTA_RPC_URLS TESTNET_IOTA_CLOCK_ID TESTNET_ORACLE_TASKS_PACKAGE_ID TESTNET_ORACLE_SYSTEM_PACKAGE_ID TESTNET_ORACLE_STATE_ID TESTNET_CONTROLLER_CAP_ID TESTNET_CONTROLLER_ADDRESS_OR_ALIAS TESTNET_ORACLE_CONTROLLER_ADDRESS \
    MAINNET_IOTA_RPC_URL MAINNET_IOTA_RPC_URLS MAINNET_IOTA_CLOCK_ID MAINNET_ORACLE_TASKS_PACKAGE_ID MAINNET_ORACLE_SYSTEM_PACKAGE_ID MAINNET_ORACLE_STATE_ID MAINNET_CONTROLLER_CAP_ID MAINNET_CONTROLLER_ADDRESS_OR_ALIAS MAINNET_ORACLE_CONTROLLER_ADDRESS
  do
    unset "$k" || true
  done
  set -a
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$ENV_FILE")
  set +a
fi

ARGS=()
if [[ "${SHOW_PENDING}" -eq 1 ]]; then
  ARGS+=(--pending)
fi
if [[ "${PENDING_ONLY}" -eq 1 ]]; then
  ARGS+=(--pending-only)
fi
if [[ "${JSON_OUTPUT}" -eq 1 ]]; then
  ARGS+=(--json)
fi
if [[ -n "${NETWORK}" ]]; then
  ARGS+=(--network "${NETWORK}")
fi

echo "[info] project: ${PROJECT_DIR}"
cd "${PROJECT_DIR}"
npm exec -- tsx src/tools/listTemplates.ts "${ARGS[@]}"
