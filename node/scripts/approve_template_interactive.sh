#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
NODE_ID="${NODE_ID:-1}"

usage() {
  cat <<'EOF'
Interactive approval for one pending template proposal.

Usage:
  ./scripts/approve_template_interactive.sh [--node <id>] [--env-file ./.env]
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

if [[ -z "$ENV_FILE" && -f "${PROJECT_DIR}/.env" ]]; then
  ENV_FILE="${PROJECT_DIR}/.env"
fi
if [[ -n "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$ENV_FILE")
  set +a
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

OPEN=("${PENDING[@]}")
echo "Pending proposals:"
for i in "${!OPEN[@]}"; do
  pid="$(printf "%s" "${OPEN[$i]}" | cut -f1)"
  tid="$(printf "%s" "${OPEN[$i]}" | cut -f2)"
  kind="$(printf "%s" "${OPEN[$i]}" | cut -f3)"
  approvals="$(printf "%s" "${OPEN[$i]}" | cut -f4)"
  needed="$(printf "%s" "${OPEN[$i]}" | cut -f5)"
  printf "  %2d) proposal_id=%s kind=%s template_id=%s approvals=%s/%s\n" "$((i+1))" "$pid" "$kind" "$tid" "$approvals" "$needed"
done

echo ""
echo "Select proposals to approve:"
echo "  - one index (example: 1)"
echo "  - multiple indexes separated by space/comma (example: 1 3 5)"
echo "  - or 'all'"
read -r -p "> " SEL_RAW
SEL_RAW="$(echo "$SEL_RAW" | tr '[:upper:]' '[:lower:]' | xargs)"
[[ -n "$SEL_RAW" ]] || { echo "[error] empty selection" >&2; exit 1; }

SELECTED_LINES=()
if [[ "$SEL_RAW" == "all" ]]; then
  SELECTED_LINES=("${OPEN[@]}")
else
  NORM="$(echo "$SEL_RAW" | tr ',' ' ')"
  declare -A seen_idx=()
  for token in $NORM; do
    [[ "$token" =~ ^[0-9]+$ ]] || { echo "[error] invalid token: $token" >&2; exit 1; }
    idx=$((token - 1))
    (( idx >= 0 && idx < ${#OPEN[@]} )) || { echo "[error] selection out of range: $token" >&2; exit 1; }
    if [[ -z "${seen_idx[$idx]:-}" ]]; then
      seen_idx[$idx]=1
      SELECTED_LINES+=("${OPEN[$idx]}")
    fi
  done
fi

echo ""
echo "Selected proposals:"
for line in "${SELECTED_LINES[@]}"; do
  pid="$(printf "%s" "$line" | cut -f1)"
  tid="$(printf "%s" "$line" | cut -f2)"
  kind="$(printf "%s" "$line" | cut -f3)"
  approvals="$(printf "%s" "$line" | cut -f4)"
  needed="$(printf "%s" "$line" | cut -f5)"
  echo "  - proposal_id=${pid} kind=${kind} template_id=${tid} approvals=${approvals}/${needed}"
done
echo "  node: ${NODE_ID}"
echo ""
read -r -p "Approve selected proposal(s) now? [y/N] " CONFIRM
CONFIRM="$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
  echo "[info] cancelled."
  exit 0
fi

cd "${PROJECT_DIR}"
for line in "${SELECTED_LINES[@]}"; do
  PROPOSAL_ID="$(printf "%s" "$line" | cut -f1)"
  TEMPLATE_ID="$(printf "%s" "$line" | cut -f2)"
  npm run cli -- accept-template-proposal --node "${NODE_ID}" --proposal-id "${PROPOSAL_ID}" --template-id "${TEMPLATE_ID}"
done

echo ""
echo "[ok] selected proposal(s) approved."
