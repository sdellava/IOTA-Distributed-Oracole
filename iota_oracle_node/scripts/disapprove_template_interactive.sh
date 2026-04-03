#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
GAS_BUDGET="${GAS_BUDGET:-50000000}"
SYSTEM_PKG="${SYSTEM_PKG:-${ORACLE_SYSTEM_PACKAGE_ID:-}}"
STATE_ID="${STATE_ID:-${ORACLE_STATE_ID:-}}"
CLOCK_ID="${CLOCK_ID:-0x6}"
NODE_ID="${NODE_ID:-1}"
SIGNER_ALIAS=""

usage() {
  cat <<'EOF'
Interactive disapprove for one pending template proposal.

This script requires Move entry function:
  systemState::disapprove_task_template_proposal(st, clock, proposal_id)

Usage:
  ./scripts/disapprove_template_interactive.sh [--node <id>] [--signer <addr_or_alias>] [--env-file ./.env]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --node" >&2; usage; exit 1; }
      NODE_ID="$1"
      ;;
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --env-file" >&2; usage; exit 1; }
      ENV_FILE="$1"
      ;;
    --signer)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --signer" >&2; usage; exit 1; }
      SIGNER_ALIAS="$1"
      ;;
    --gas-budget)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --gas-budget" >&2; usage; exit 1; }
      GAS_BUDGET="$1"
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

[[ "$NODE_ID" =~ ^[0-9]+$ ]] || { echo "[error] --node must be numeric" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MOVE_SRC="${PROJECT_DIR}/../iota_oracle_move/oracle_system_state_devnet/sources/iota_oracle_system_state.move"

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

if [[ ! -f "$MOVE_SRC" ]] || ! grep -q "public entry fun disapprove_task_template_proposal" "$MOVE_SRC"; then
  echo "[error] disapprove is not available in current Move module."
  echo "Add public entry fun disapprove_task_template_proposal(...) and republish."
  exit 2
fi

JSON="$(cd "${PROJECT_DIR}" && npm exec -- tsx src/tools/listTemplates.ts --pending-only --json)"
mapfile -t PENDING < <(printf "%s" "$JSON" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const pending = Array.isArray(data?.pendingProposals) ? data.pendingProposals : [];
pending.sort((a,b) => Number(a.proposalId) - Number(b.proposalId));
for (const p of pending) {
  const id = Number(p?.proposalId);
  const tid = Number(p?.templateId);
  const kind = String(p?.kind ?? "");
  const approvals = Number(p?.approvals ?? 0);
  const needed = Number(p?.approvalsNeeded ?? 0);
  process.stdout.write(`${id}\t${tid}\t${kind}\t${approvals}\t${needed}\n`);
}
')

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "[info] no pending proposals."
  exit 0
fi

echo "Pending proposals:"
for i in "${!PENDING[@]}"; do
  pid="$(printf "%s" "${PENDING[$i]}" | cut -f1)"
  tid="$(printf "%s" "${PENDING[$i]}" | cut -f2)"
  kind="$(printf "%s" "${PENDING[$i]}" | cut -f3)"
  approvals="$(printf "%s" "${PENDING[$i]}" | cut -f4)"
  needed="$(printf "%s" "${PENDING[$i]}" | cut -f5)"
  printf "  %2d) proposal_id=%s kind=%s template_id=%s approvals=%s/%s\n" "$((i+1))" "$pid" "$kind" "$tid" "$approvals" "$needed"
done

echo ""
read -r -p "Select one proposal to disapprove: " IDX
[[ "$IDX" =~ ^[0-9]+$ ]] || { echo "[error] invalid selection" >&2; exit 1; }
SEL=$((IDX - 1))
(( SEL >= 0 && SEL < ${#PENDING[@]} )) || { echo "[error] selection out of range" >&2; exit 1; }
PROPOSAL_ID="$(printf "%s" "${PENDING[$SEL]}" | cut -f1)"

echo ""
echo "Selected proposal_id=${PROPOSAL_ID} (node=${NODE_ID})"
read -r -p "Disapprove now? [y/N] " CONFIRM
CONFIRM="$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
  echo "[info] cancelled."
  exit 0
fi

cd "${PROJECT_DIR}"
if [[ -z "$SIGNER_ALIAS" ]]; then
  SIGNER_ALIAS="oracle-node-${NODE_ID}"
fi
iota client switch --address "$SIGNER_ALIAS" >/dev/null
iota client ptb \
  --move-call "${SYSTEM_PKG}::systemState::disapprove_task_template_proposal" \
  "@${STATE_ID}" \
  "@${CLOCK_ID}" \
  "${PROPOSAL_ID}" \
  --gas-budget "${GAS_BUDGET}"

echo ""
echo "[ok] proposal disapproved."
