#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

# -----------------------------------------------------------------------------
# Oracle task templates governance setup for:
# 0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a836dea2::systemState
# -----------------------------------------------------------------------------
# Current Move notes:
# - propose_task_template_upsert(cap, st, clock, timeout, template_id, task_type,
#   is_enabled, base_price_iota, max_input_bytes, max_output_bytes,
#   included_download_bytes, price_per_download_byte_iota,
#   allow_storage, min_retention_days, max_retention_days,
#   price_per_retention_day_iota, ctx)
# - approve_task_template_proposal(st, clock, proposal_id, ctx)
# - Clock shared object = 0x6
# -----------------------------------------------------------------------------

SYSTEM_PKG="${SYSTEM_PKG:-${DEVNET_ORACLE_SYSTEM_PACKAGE_ID:-${ORACLE_SYSTEM_PACKAGE_ID:-0xbfc326f5d151be3c5f7544efd2a49b62c6276e25deefbe0e950e3f13e50d6434}}}"
STATE_ID="${STATE_ID:-${DEVNET_ORACLE_STATE_ID:-${ORACLE_STATE_ID:-0x45cc11a20f16fd1566076a9ce81a6c3cb1db6ce6c7f80751d4daff03954a3b2b}}}"
CONTROLLER_CAP_ID="${CONTROLLER_CAP_ID:-0xa60b03ad45ed46c564ba1620b0347500b34cd082064004f4521cff0c53672dfd}"
CLOCK_ID="${CLOCK_ID:-0x6}"
ORACLE_TASKS_PACKAGE_ID="${ORACLE_TASKS_PACKAGE_ID:-0x4124d07d2bc1c31c60d2fa54c6fcab7e631dbedd085f724e22fc054f9c22b342}"
ORACLE_TREASURY_ID="${ORACLE_TREASURY_ID:-${DEVNET_ORACLE_TREASURY_ID:-0x361ec4240051fc8a491b3b482785e18460e5a843bae7bf87c989fe80d18c7e89}}"

CONTROLLER_ADDRESS_OR_ALIAS="${CONTROLLER_ADDRESS_OR_ALIAS:-}"
PROPOSAL_TIMEOUT_MS="${PROPOSAL_TIMEOUT_MS:-600000}"
GAS_BUDGET="${GAS_BUDGET:-50000000}"

TASK_TYPE_RANDOM="${TASK_TYPE_RANDOM:-RANDOM_NUMBER_MEDIATION}"
TASK_TYPE_COMMODITY="${TASK_TYPE_COMMODITY:-COMMODITY_PRICE}"
TASK_TYPE_WEATHER="${TASK_TYPE_WEATHER:-WEATHER}"
TASK_TYPE_STORAGE="${TASK_TYPE_STORAGE:-STORAGE}"
TASK_TYPE_LLM_EXTRACT="${TASK_TYPE_LLM_EXTRACT:-LLM_EXTRACT_STRUCTURED}"
TASK_TYPE_LLM_CLASSIFY="${TASK_TYPE_LLM_CLASSIFY:-LLM_CLASSIFY_DOCUMENT}"
TASK_TYPE_LLM_RISK="${TASK_TYPE_LLM_RISK:-LLM_RISK_SCORE}"
TASK_TYPE_DLVC="${TASK_TYPE_DLVC:-DLVC_VALIDATION}"

TPL_RANDOM_ID="${TPL_RANDOM_ID:-1}"
TPL_RANDOM_ENABLED="${TPL_RANDOM_ENABLED:-1}"
TPL_RANDOM_BASE_PRICE="${TPL_RANDOM_BASE_PRICE:-1000000000}"
TPL_RANDOM_MAX_INPUT="${TPL_RANDOM_MAX_INPUT:-4096}"
TPL_RANDOM_MAX_OUTPUT="${TPL_RANDOM_MAX_OUTPUT:-4096}"
TPL_RANDOM_INCLUDED_DOWNLOAD="${TPL_RANDOM_INCLUDED_DOWNLOAD:-4096}"
TPL_RANDOM_PRICE_PER_DOWNLOAD_BYTE="${TPL_RANDOM_PRICE_PER_DOWNLOAD_BYTE:-0}"

TPL_COMMODITY_ID="${TPL_COMMODITY_ID:-2}"
TPL_COMMODITY_ENABLED="${TPL_COMMODITY_ENABLED:-1}"
TPL_COMMODITY_BASE_PRICE="${TPL_COMMODITY_BASE_PRICE:-1000000000}"
TPL_COMMODITY_MAX_INPUT="${TPL_COMMODITY_MAX_INPUT:-8192}"
TPL_COMMODITY_MAX_OUTPUT="${TPL_COMMODITY_MAX_OUTPUT:-8192}"
TPL_COMMODITY_INCLUDED_DOWNLOAD="${TPL_COMMODITY_INCLUDED_DOWNLOAD:-8192}"
TPL_COMMODITY_PRICE_PER_DOWNLOAD_BYTE="${TPL_COMMODITY_PRICE_PER_DOWNLOAD_BYTE:-0}"

TPL_WEATHER_ID="${TPL_WEATHER_ID:-3}"
TPL_WEATHER_ENABLED="${TPL_WEATHER_ENABLED:-1}"
TPL_WEATHER_BASE_PRICE="${TPL_WEATHER_BASE_PRICE:-1000000000}"
TPL_WEATHER_MAX_INPUT="${TPL_WEATHER_MAX_INPUT:-8192}"
TPL_WEATHER_MAX_OUTPUT="${TPL_WEATHER_MAX_OUTPUT:-8192}"
TPL_WEATHER_INCLUDED_DOWNLOAD="${TPL_WEATHER_INCLUDED_DOWNLOAD:-8192}"
TPL_WEATHER_PRICE_PER_DOWNLOAD_BYTE="${TPL_WEATHER_PRICE_PER_DOWNLOAD_BYTE:-0}"

TPL_STORAGE_ID="${TPL_STORAGE_ID:-4}"
TPL_STORAGE_ENABLED="${TPL_STORAGE_ENABLED:-1}"
TPL_STORAGE_BASE_PRICE="${TPL_STORAGE_BASE_PRICE:-500000000}"
TPL_STORAGE_MAX_INPUT="${TPL_STORAGE_MAX_INPUT:-8192}"
TPL_STORAGE_MAX_OUTPUT="${TPL_STORAGE_MAX_OUTPUT:-10485760}"
TPL_STORAGE_INCLUDED_DOWNLOAD="${TPL_STORAGE_INCLUDED_DOWNLOAD:-10485760}"
TPL_STORAGE_PRICE_PER_DOWNLOAD_BYTE="${TPL_STORAGE_PRICE_PER_DOWNLOAD_BYTE:-0}"
TPL_STORAGE_MIN_RETENTION="${TPL_STORAGE_MIN_RETENTION:-1}"
TPL_STORAGE_MAX_RETENTION="${TPL_STORAGE_MAX_RETENTION:-365}"
TPL_STORAGE_PRICE_PER_DAY="${TPL_STORAGE_PRICE_PER_DAY:-10000}"

TPL_LLM_EXTRACT_ID="${TPL_LLM_EXTRACT_ID:-5}"
TPL_LLM_EXTRACT_ENABLED="${TPL_LLM_EXTRACT_ENABLED:-1}"
TPL_LLM_EXTRACT_BASE_PRICE="${TPL_LLM_EXTRACT_BASE_PRICE:-2500000000}"
TPL_LLM_EXTRACT_MAX_INPUT="${TPL_LLM_EXTRACT_MAX_INPUT:-16384}"
TPL_LLM_EXTRACT_MAX_OUTPUT="${TPL_LLM_EXTRACT_MAX_OUTPUT:-4096}"
TPL_LLM_EXTRACT_INCLUDED_DOWNLOAD="${TPL_LLM_EXTRACT_INCLUDED_DOWNLOAD:-10485760}"
TPL_LLM_EXTRACT_PRICE_PER_DOWNLOAD_BYTE="${TPL_LLM_EXTRACT_PRICE_PER_DOWNLOAD_BYTE:-0}"

TPL_LLM_CLASSIFY_ID="${TPL_LLM_CLASSIFY_ID:-6}"
TPL_LLM_CLASSIFY_ENABLED="${TPL_LLM_CLASSIFY_ENABLED:-1}"
TPL_LLM_CLASSIFY_BASE_PRICE="${TPL_LLM_CLASSIFY_BASE_PRICE:-1500000000}"
TPL_LLM_CLASSIFY_MAX_INPUT="${TPL_LLM_CLASSIFY_MAX_INPUT:-16384}"
TPL_LLM_CLASSIFY_MAX_OUTPUT="${TPL_LLM_CLASSIFY_MAX_OUTPUT:-1024}"
TPL_LLM_CLASSIFY_INCLUDED_DOWNLOAD="${TPL_LLM_CLASSIFY_INCLUDED_DOWNLOAD:-10485760}"
TPL_LLM_CLASSIFY_PRICE_PER_DOWNLOAD_BYTE="${TPL_LLM_CLASSIFY_PRICE_PER_DOWNLOAD_BYTE:-0}"

TPL_LLM_RISK_ID="${TPL_LLM_RISK_ID:-7}"
TPL_LLM_RISK_ENABLED="${TPL_LLM_RISK_ENABLED:-1}"
TPL_LLM_RISK_BASE_PRICE="${TPL_LLM_RISK_BASE_PRICE:-2000000000}"
TPL_LLM_RISK_MAX_INPUT="${TPL_LLM_RISK_MAX_INPUT:-16384}"
TPL_LLM_RISK_MAX_OUTPUT="${TPL_LLM_RISK_MAX_OUTPUT:-256}"
TPL_LLM_RISK_INCLUDED_DOWNLOAD="${TPL_LLM_RISK_INCLUDED_DOWNLOAD:-10485760}"
TPL_LLM_RISK_PRICE_PER_DOWNLOAD_BYTE="${TPL_LLM_RISK_PRICE_PER_DOWNLOAD_BYTE:-0}"

TPL_DLVC_ID="${TPL_DLVC_ID:-8}"
TPL_DLVC_ENABLED="${TPL_DLVC_ENABLED:-$TPL_LLM_RISK_ENABLED}"
TPL_DLVC_BASE_PRICE="${TPL_DLVC_BASE_PRICE:-$TPL_LLM_RISK_BASE_PRICE}"
TPL_DLVC_MAX_INPUT="${TPL_DLVC_MAX_INPUT:-$TPL_LLM_RISK_MAX_INPUT}"
TPL_DLVC_MAX_OUTPUT="${TPL_DLVC_MAX_OUTPUT:-$TPL_LLM_RISK_MAX_OUTPUT}"
TPL_DLVC_INCLUDED_DOWNLOAD="${TPL_DLVC_INCLUDED_DOWNLOAD:-$TPL_LLM_RISK_INCLUDED_DOWNLOAD}"
TPL_DLVC_PRICE_PER_DOWNLOAD_BYTE="${TPL_DLVC_PRICE_PER_DOWNLOAD_BYTE:-$TPL_LLM_RISK_PRICE_PER_DOWNLOAD_BYTE}"

NODE1_ALIAS="${NODE1_ALIAS:-oracle-node-1}"
NODE2_ALIAS="${NODE2_ALIAS:-oracle-node-2}"
NODE3_ALIAS="${NODE3_ALIAS:-oracle-node-3}"

ONLY_TEMPLATE=""
LAST_PROPOSAL_ID=""

usage() {
  cat <<EOF
Usage:
  $0 [--only random|commodity|weather|storage|llm-extract|llm-classify|llm-risk|dlvc]

Examples:
  $0
  $0 --only storage
  $0 --only weather
  $0 --only llm-extract
  $0 --only llm-classify
  $0 --only llm-risk
  $0 --only dlvc
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --only)
        shift
        [[ $# -gt 0 ]] || { echo "[error] missing value for --only" >&2; usage; exit 1; }
        ONLY_TEMPLATE="$1"
        case "$ONLY_TEMPLATE" in
          random|commodity|weather|storage|llm-extract|llm-classify|llm-risk|llm_extract|llm_classify|llm_risk|dlvc) ;;
          *)
            echo "[error] invalid value for --only: $ONLY_TEMPLATE" >&2
            usage
            exit 1
            ;;
        esac
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
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "[error] command not found: $1" >&2; exit 1; }
}

resolve_address() {
  local who="$1"
  if [[ "$who" == 0x* ]]; then
    printf '%s\n' "$who"
    return 0
  fi

  local resolved
  resolved="$(
    iota client addresses 2>/dev/null | awk -F'│' -v target="$who" '
      {
        alias=$2
        address=$3
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", alias)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", address)
        if (alias == target) {
          print address
          exit
        }
      }
    '
  )"

  [[ -n "$resolved" ]] || {
    echo "[error] alias not found in client config: $who" >&2
    echo "[hint] available aliases:" >&2
    iota client addresses >&2 || true
    exit 1
  }

  printf '%s\n' "$resolved"
}

switch_address() {
  local who="$1"
  local resolved
  resolved="$(resolve_address "$who")"
  echo "[switch] address=$who -> $resolved"
  iota client switch --address "$resolved" >/dev/null
}

ptb_move_call() {
  local sender="$1"
  shift
  switch_address "$sender"
  echo "> iota client ptb $* --gas-budget $GAS_BUDGET"
  iota client ptb "$@" --gas-budget "$GAS_BUDGET"
}

current_proposal_counter() {
  iota client object "${STATE_ID}" --json \
    | node -e '
const fs = require("fs");
const txt = fs.readFileSync(0, "utf8");
const data = JSON.parse(txt);
function walk(x) {
  if (!x || typeof x !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(x, "template_proposal_id")) return x.template_proposal_id;
  for (const v of Object.values(x)) {
    const out = walk(v);
    if (out !== undefined) return out;
  }
  return undefined;
}
const v = walk(data);
if (v === undefined || v === null || v === "") throw new Error("template_proposal_id not found");
process.stdout.write(String(v));
'
}

propose_template_upsert() {
  local template_id="$1"
  local task_type="$2"
  local is_enabled="$3"
  local base_price_iota="$4"
  local max_input_bytes="$5"
  local max_output_bytes="$6"
  local included_download_bytes="$7"
  local price_per_download_byte_iota="$8"
  local allow_storage="$9"
  local min_retention_days="${10}"
  local max_retention_days="${11}"
  local price_per_retention_day_iota="${12}"

  [[ -n "$CONTROLLER_ADDRESS_OR_ALIAS" ]] || {
    echo "[error] set CONTROLLER_ADDRESS_OR_ALIAS to the deployer/controller alias or address" >&2
    exit 1
  }

  ptb_move_call "$CONTROLLER_ADDRESS_OR_ALIAS" \
    --move-call "${SYSTEM_PKG}::systemState::propose_task_template_upsert" \
    "@${CONTROLLER_CAP_ID}" \
    "@${STATE_ID}" \
    "@${CLOCK_ID}" \
    "$PROPOSAL_TIMEOUT_MS" \
    "$template_id" \
    "\"$task_type\"" \
    "$is_enabled" \
    "$base_price_iota" \
    "$max_input_bytes" \
    "$max_output_bytes" \
    "$included_download_bytes" \
    "$price_per_download_byte_iota" \
    "$allow_storage" \
    "$min_retention_days" \
    "$max_retention_days" \
    "$price_per_retention_day_iota"

  LAST_PROPOSAL_ID="$(current_proposal_counter)"
  echo "[info] created proposal_id=${LAST_PROPOSAL_ID} for template_id=${template_id}"
}

approve_current_proposal() {
  local node_alias="$1"
  local proposal_id="$2"
  ptb_move_call "$node_alias" \
    --move-call "${SYSTEM_PKG}::systemState::approve_task_template_proposal" \
    "@${STATE_ID}" \
    "@${CLOCK_ID}" \
    "$proposal_id"
}

setup_template() {
  local label="$1"
  local template_id="$2"
  local task_type="$3"
  local is_enabled="$4"
  local base_price_iota="$5"
  local max_input_bytes="$6"
  local max_output_bytes="$7"
  local included_download_bytes="$8"
  local price_per_download_byte_iota="$9"
  local allow_storage="${10}"
  local min_retention_days="${11}"
  local max_retention_days="${12}"
  local price_per_retention_day_iota="${13}"

  echo
  echo "============================================================"
  echo "Template: $label"
  echo "============================================================"
  echo "[1/3] propose"
  propose_template_upsert \
    "$template_id" \
    "$task_type" \
    "$is_enabled" \
    "$base_price_iota" \
    "$max_input_bytes" \
    "$max_output_bytes" \
    "$included_download_bytes" \
    "$price_per_download_byte_iota" \
    "$allow_storage" \
    "$min_retention_days" \
    "$max_retention_days" \
    "$price_per_retention_day_iota"
  [[ -n "${LAST_PROPOSAL_ID}" ]] || {
    echo "[error] proposal_id not resolved after propose" >&2
    exit 1
  }

  echo "[2/3] approve by $NODE1_ALIAS"
  approve_current_proposal "$NODE1_ALIAS" "$LAST_PROPOSAL_ID"

  echo "[3/3] approve by $NODE2_ALIAS"
  approve_current_proposal "$NODE2_ALIAS" "$LAST_PROPOSAL_ID"

  echo "[ok] template applied: $label"
}

parse_args "$@"
require_cmd iota

echo "[info] env=$(iota client active-env 2>/dev/null || true)"
echo "[info] active-address=$(iota client active-address 2>/dev/null || true)"
echo "[info] controller=${CONTROLLER_ADDRESS_OR_ALIAS:-<not set>}"
echo "[info] ORACLE_TASKS_PACKAGE_ID=$ORACLE_TASKS_PACKAGE_ID"
echo "[info] SYSTEM_PKG=$SYSTEM_PKG"
echo "[info] STATE_ID=$STATE_ID"
echo "[info] ORACLE_TREASURY_ID=$ORACLE_TREASURY_ID"
echo "[info] CONTROLLER_CAP_ID=$CONTROLLER_CAP_ID"
echo "[info] CLOCK_ID=$CLOCK_ID"
echo "[info] only=${ONLY_TEMPLATE:-all}"

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "random" ]]; then
  setup_template \
    "RANDOM_NUMBER_MEDIATION" \
    "$TPL_RANDOM_ID" \
    "$TASK_TYPE_RANDOM" \
    "$TPL_RANDOM_ENABLED" \
    "$TPL_RANDOM_BASE_PRICE" \
    "$TPL_RANDOM_MAX_INPUT" \
    "$TPL_RANDOM_MAX_OUTPUT" \
    "$TPL_RANDOM_INCLUDED_DOWNLOAD" \
    "$TPL_RANDOM_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "commodity" ]]; then
  setup_template \
    "COMMODITY_PRICE" \
    "$TPL_COMMODITY_ID" \
    "$TASK_TYPE_COMMODITY" \
    "$TPL_COMMODITY_ENABLED" \
    "$TPL_COMMODITY_BASE_PRICE" \
    "$TPL_COMMODITY_MAX_INPUT" \
    "$TPL_COMMODITY_MAX_OUTPUT" \
    "$TPL_COMMODITY_INCLUDED_DOWNLOAD" \
    "$TPL_COMMODITY_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "weather" ]]; then
  setup_template \
    "WEATHER" \
    "$TPL_WEATHER_ID" \
    "$TASK_TYPE_WEATHER" \
    "$TPL_WEATHER_ENABLED" \
    "$TPL_WEATHER_BASE_PRICE" \
    "$TPL_WEATHER_MAX_INPUT" \
    "$TPL_WEATHER_MAX_OUTPUT" \
    "$TPL_WEATHER_INCLUDED_DOWNLOAD" \
    "$TPL_WEATHER_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "storage" ]]; then
  setup_template \
    "STORAGE" \
    "$TPL_STORAGE_ID" \
    "$TASK_TYPE_STORAGE" \
    "$TPL_STORAGE_ENABLED" \
    "$TPL_STORAGE_BASE_PRICE" \
    "$TPL_STORAGE_MAX_INPUT" \
    "$TPL_STORAGE_MAX_OUTPUT" \
    "$TPL_STORAGE_INCLUDED_DOWNLOAD" \
    "$TPL_STORAGE_PRICE_PER_DOWNLOAD_BYTE" \
    1 \
    "$TPL_STORAGE_MIN_RETENTION" \
    "$TPL_STORAGE_MAX_RETENTION" \
    "$TPL_STORAGE_PRICE_PER_DAY"
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "llm-extract" || "$ONLY_TEMPLATE" == "llm_extract" ]]; then
  setup_template \
    "LLM_EXTRACT_STRUCTURED" \
    "$TPL_LLM_EXTRACT_ID" \
    "$TASK_TYPE_LLM_EXTRACT" \
    "$TPL_LLM_EXTRACT_ENABLED" \
    "$TPL_LLM_EXTRACT_BASE_PRICE" \
    "$TPL_LLM_EXTRACT_MAX_INPUT" \
    "$TPL_LLM_EXTRACT_MAX_OUTPUT" \
    "$TPL_LLM_EXTRACT_INCLUDED_DOWNLOAD" \
    "$TPL_LLM_EXTRACT_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "llm-classify" || "$ONLY_TEMPLATE" == "llm_classify" ]]; then
  setup_template \
    "LLM_CLASSIFY_DOCUMENT" \
    "$TPL_LLM_CLASSIFY_ID" \
    "$TASK_TYPE_LLM_CLASSIFY" \
    "$TPL_LLM_CLASSIFY_ENABLED" \
    "$TPL_LLM_CLASSIFY_BASE_PRICE" \
    "$TPL_LLM_CLASSIFY_MAX_INPUT" \
    "$TPL_LLM_CLASSIFY_MAX_OUTPUT" \
    "$TPL_LLM_CLASSIFY_INCLUDED_DOWNLOAD" \
    "$TPL_LLM_CLASSIFY_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "llm-risk" || "$ONLY_TEMPLATE" == "llm_risk" ]]; then
  setup_template \
    "LLM_RISK_SCORE" \
    "$TPL_LLM_RISK_ID" \
    "$TASK_TYPE_LLM_RISK" \
    "$TPL_LLM_RISK_ENABLED" \
    "$TPL_LLM_RISK_BASE_PRICE" \
    "$TPL_LLM_RISK_MAX_INPUT" \
    "$TPL_LLM_RISK_MAX_OUTPUT" \
    "$TPL_LLM_RISK_INCLUDED_DOWNLOAD" \
    "$TPL_LLM_RISK_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

if [[ -z "$ONLY_TEMPLATE" || "$ONLY_TEMPLATE" == "dlvc" ]]; then
  setup_template \
    "DLVC_VALIDATION" \
    "$TPL_DLVC_ID" \
    "$TASK_TYPE_DLVC" \
    "$TPL_DLVC_ENABLED" \
    "$TPL_DLVC_BASE_PRICE" \
    "$TPL_DLVC_MAX_INPUT" \
    "$TPL_DLVC_MAX_OUTPUT" \
    "$TPL_DLVC_INCLUDED_DOWNLOAD" \
    "$TPL_DLVC_PRICE_PER_DOWNLOAD_BYTE" \
    0 0 0 0
fi

echo
echo "[done] requested template setup completed."
