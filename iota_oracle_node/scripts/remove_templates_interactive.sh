#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

ENV_FILE=""
PROPOSAL_TIMEOUT_MS="${PROPOSAL_TIMEOUT_MS:-600000}"
GAS_BUDGET="${GAS_BUDGET:-50000000}"
SYSTEM_PKG="${SYSTEM_PKG:-${ORACLE_SYSTEM_PACKAGE_ID:-}}"
STATE_ID="${STATE_ID:-${ORACLE_STATE_ID:-}}"
CLOCK_ID="${CLOCK_ID:-0x6}"
CONTROLLER_CAP_ID="${CONTROLLER_CAP_ID:-}"
CONTROLLER_ADDRESS_OR_ALIAS="${CONTROLLER_ADDRESS_OR_ALIAS:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --env-file" >&2; exit 1; }
      ENV_FILE="$1"
      ;;
    -h|--help)
      echo "Usage: ./scripts/remove_templates_interactive.sh [--env-file ./.env]"
      exit 0
      ;;
    *)
      echo "[error] unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLOSE_EXPIRED_SCRIPT="${SCRIPT_DIR}/close_expired_template_proposals.sh"
[[ -f "$CLOSE_EXPIRED_SCRIPT" ]] || { echo "[error] missing script: $CLOSE_EXPIRED_SCRIPT" >&2; exit 1; }

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
CONTROLLER_CAP_ID="${CONTROLLER_CAP_ID:-$(get_prefixed_env CONTROLLER_CAP_ID)}"
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(get_prefixed_env CONTROLLER_ADDRESS_OR_ALIAS)"
fi
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(get_prefixed_env ORACLE_CONTROLLER_ADDRESS)"
fi
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="$(iota client active-address 2>/dev/null | tr -d '\r' | xargs || true)"
fi
[[ -n "$SYSTEM_PKG" ]] || { echo "[error] missing ORACLE_SYSTEM_PACKAGE_ID" >&2; exit 1; }
[[ -n "$STATE_ID" ]] || { echo "[error] missing ORACLE_STATE_ID" >&2; exit 1; }
[[ -n "$CONTROLLER_CAP_ID" ]] || { echo "[error] missing CONTROLLER_CAP_ID" >&2; exit 1; }
[[ -n "$CONTROLLER_ADDRESS_OR_ALIAS" ]] || { echo "[error] missing controller address/alias" >&2; exit 1; }

JSON="$(cd "${PROJECT_DIR}" && npm exec -- tsx src/tools/listTemplates.ts --json)"
mapfile -t APPROVED_LINES < <(printf "%s" "$JSON" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const approved = Array.isArray(data?.approvedTemplates) ? data.approvedTemplates : [];
approved.sort((a,b) => Number(a.templateId)-Number(b.templateId));
for (const t of approved) {
  process.stdout.write(`${Number(t.templateId)}\t${String(t.taskType ?? "")}\tapproved\n`);
}
')

mapfile -t PENDING_LINES < <(printf "%s" "$JSON" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const pending = Array.isArray(data?.pendingProposals) ? data.pendingProposals : [];
pending.sort((a,b) => Number(a.proposalId)-Number(b.proposalId));
for (const p of pending) {
  process.stdout.write(`${Number(p.proposalId)}\t${Number(p.templateId)}\t${String(p.kind ?? "")}\t${Number(p.deadlineMs ?? 0)}\n`);
}
')

declare -A PENDING_REMOVE_BY_TEMPLATE=()
declare -A PENDING_UPSERT_BY_TEMPLATE=()
for line in "${PENDING_LINES[@]:-}"; do
  pid="$(printf "%s" "$line" | cut -f1)"
  tid="$(printf "%s" "$line" | cut -f2)"
  kind="$(printf "%s" "$line" | cut -f3)"
  [[ "$tid" =~ ^[0-9]+$ ]] || continue
  if [[ "$kind" == "remove" && -z "${PENDING_REMOVE_BY_TEMPLATE[$tid]:-}" ]]; then
    PENDING_REMOVE_BY_TEMPLATE[$tid]="$pid"
  fi
  if [[ "$kind" == "upsert" && -z "${PENDING_UPSERT_BY_TEMPLATE[$tid]:-}" ]]; then
    PENDING_UPSERT_BY_TEMPLATE[$tid]="$pid"
  fi
done

EXAMPLES_DIR="${PROJECT_DIR}/src/tasks/examples"
mapfile -t EXAMPLE_LINES < <(find "$EXAMPLES_DIR" -maxdepth 1 -type f -name '*.json' -print0 | node -e '
const fs = require("fs");
const path = require("path");
const chunks = fs.readFileSync(0).toString("utf8").split("\0").filter(Boolean);
for (const p of chunks.sort()) {
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const tid = Number(j?.template_id ?? j?.template?.template_id);
    const typ = String(j?.type ?? j?.template?.type ?? "").trim();
    if (Number.isFinite(tid) && tid > 0) process.stdout.write(`${tid}\t${typ}\texample\n`);
  } catch {}
}
')

echo "Choose mode:"
echo "  1) propose template removals (independent from approved/pending state)"
echo "  2) clean expired pending proposals"
read -r -p "> " MODE
MODE="$(echo "$MODE" | xargs)"
[[ "$MODE" == "1" || "$MODE" == "2" ]] || { echo "[error] invalid mode" >&2; exit 1; }

if [[ "$MODE" == "1" ]]; then
  mapfile -t CANDIDATES < <(
    {
      printf "%s\n" "${APPROVED_LINES[@]:-}"
      printf "%s\n" "${EXAMPLE_LINES[@]:-}"
      for line in "${PENDING_LINES[@]:-}"; do
        pid="$(printf "%s" "$line" | cut -f1)"
        tid="$(printf "%s" "$line" | cut -f2)"
        kind="$(printf "%s" "$line" | cut -f3)"
        printf "%s\t<from-pending:%s#%s>\tpending\n" "$tid" "$kind" "$pid"
      done
    } | awk -F'\t' '
      NF>=1 {
        id=$1; type=$2; src=$3;
        if (id ~ /^[0-9]+$/) {
          if (!(id in seen)) { seen[id]=1; types[id]=type; srcs[id]=src; }
          else {
            if (types[id]=="" || types[id] ~ /^<from-pending:/) types[id]=type;
            srcs[id]=srcs[id] "," src;
          }
        }
      }
      END {
        for (id in seen) printf "%s\t%s\t%s\n", id, types[id], srcs[id];
      }
    ' | sort -n -k1,1
  )

  if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
    echo "[info] no template candidates found (approved/pending/examples all empty)."
    exit 0
  fi

  echo "Template candidates (from approved/pending/examples):"
  for i in "${!CANDIDATES[@]}"; do
    tid="$(printf "%s" "${CANDIDATES[$i]}" | cut -f1)"
    typ="$(printf "%s" "${CANDIDATES[$i]}" | cut -f2)"
    src="$(printf "%s" "${CANDIDATES[$i]}" | cut -f3)"
    printf "  %2d) id=%s type=%s source=%s\n" "$((i+1))" "$tid" "$typ" "$src"
  done

  echo ""
  echo "Select templates to remove:"
  echo "  - numbers separated by space/comma (example: 1 3)"
  echo "  - or 'all'"
  read -r -p "> " SEL
  SEL="$(echo "$SEL" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ -n "$SEL" ]] || { echo "[error] empty selection" >&2; exit 1; }

  SELECTED=()
  if [[ "$SEL" == "all" ]]; then
    for line in "${CANDIDATES[@]}"; do
      SELECTED+=("$(printf "%s" "$line" | cut -f1)")
    done
  else
    NORM="$(echo "$SEL" | tr ',' ' ')"
    declare -A seen=()
    for token in $NORM; do
      [[ "$token" =~ ^[0-9]+$ ]] || { echo "[error] invalid token: $token" >&2; exit 1; }
      idx=$((token - 1))
      (( idx >= 0 && idx < ${#CANDIDATES[@]} )) || { echo "[error] index out of range: $token" >&2; exit 1; }
      if [[ -z "${seen[$idx]:-}" ]]; then
        seen[$idx]=1
        SELECTED+=("$(printf "%s" "${CANDIDATES[$idx]}" | cut -f1)")
      fi
    done
  fi

  iota client switch --address "$CONTROLLER_ADDRESS_OR_ALIAS" >/dev/null
  TO_REMOVE=()
  for tid in "${SELECTED[@]}"; do
    if [[ -n "${PENDING_REMOVE_BY_TEMPLATE[$tid]:-}" ]]; then
      echo "[skip] template_id=${tid} already has pending remove proposal_id=${PENDING_REMOVE_BY_TEMPLATE[$tid]}"
      continue
    fi
    TO_REMOVE+=("$tid")
  done

  if [[ ${#TO_REMOVE[@]} -eq 0 ]]; then
    echo "[info] nothing to submit: all selected template ids already have pending remove proposals."
    exit 0
  fi

  echo ""
  if [[ "$SEL" == "all" && ${#TO_REMOVE[@]} -gt 1 ]]; then
    echo "[info] submitting a single batch transaction for ${#TO_REMOVE[@]} template removals."
    CMD=(iota client ptb)
    for tid in "${TO_REMOVE[@]}"; do
      CMD+=(
        --move-call "${SYSTEM_PKG}::systemState::propose_task_template_remove"
        "@${CONTROLLER_CAP_ID}"
        "@${STATE_ID}"
        "@${CLOCK_ID}"
        "$PROPOSAL_TIMEOUT_MS"
        "$tid"
      )
    done
    CMD+=(--gas-budget "$GAS_BUDGET")
    "${CMD[@]}"
  else
    for tid in "${TO_REMOVE[@]}"; do
      echo "============================================================"
      echo "[remove-propose] template_id=${tid}"
      echo "============================================================"
      iota client ptb \
        --move-call "${SYSTEM_PKG}::systemState::propose_task_template_remove" \
        "@${CONTROLLER_CAP_ID}" \
        "@${STATE_ID}" \
        "@${CLOCK_ID}" \
        "$PROPOSAL_TIMEOUT_MS" \
        "$tid" \
        --gas-budget "$GAS_BUDGET"
    done
  fi
  echo ""
  echo "[ok] remove proposals submitted."
  exit 0
fi

if [[ ${#PENDING_LINES[@]} -eq 0 ]]; then
  echo "[info] no pending proposals."
  exit 0
fi

now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
expired_count=0
echo "Pending proposals:"
for i in "${!PENDING_LINES[@]}"; do
  pid="$(printf "%s" "${PENDING_LINES[$i]}" | cut -f1)"
  tid="$(printf "%s" "${PENDING_LINES[$i]}" | cut -f2)"
  kind="$(printf "%s" "${PENDING_LINES[$i]}" | cut -f3)"
  deadline_ms="$(printf "%s" "${PENDING_LINES[$i]}" | cut -f4)"
  status="open"
  if [[ "$deadline_ms" =~ ^[0-9]+$ ]] && (( deadline_ms <= now_ms )); then
    status="expired"
    expired_count=$((expired_count + 1))
  fi
  printf "  - proposal_id=%s template_id=%s kind=%s status=%s\n" "$pid" "$tid" "$kind" "$status"
done

if (( expired_count == 0 )); then
  echo ""
  echo "[info] no expired pending proposals to remove yet."
  exit 0
fi

echo ""
echo "Expired pending proposals found: ${expired_count}"
read -r -p "Run close_expired_task_template_proposal now? [y/N] " CONFIRM
CONFIRM="$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
  echo "[info] cancelled."
  exit 0
fi

bash "$CLOSE_EXPIRED_SCRIPT" ${ENV_FILE:+--env-file "$ENV_FILE"}

echo ""
echo "[ok] expired pending proposals cleanup executed."
