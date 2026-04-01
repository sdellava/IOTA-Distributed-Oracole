#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

TEMPLATE_JSON=""
ENV_FILE=""
TEMPLATE_ID_OVERRIDE=""
PROPOSAL_TIMEOUT_MS="${PROPOSAL_TIMEOUT_MS:-600000}"
GAS_BUDGET="${GAS_BUDGET:-50000000}"
CONTROLLER_ADDRESS_OR_ALIAS="${CONTROLLER_ADDRESS_OR_ALIAS:-}"
SYSTEM_PKG="${SYSTEM_PKG:-${ORACLE_SYSTEM_PACKAGE_ID:-}}"
STATE_ID="${STATE_ID:-${ORACLE_STATE_ID:-}}"
CONTROLLER_CAP_ID="${CONTROLLER_CAP_ID:-${ORACLE_CONTROLLER_CAP_ID:-}}"
CLOCK_ID="${CLOCK_ID:-0x6}"

usage() {
  cat <<'EOF'
Propose a new task template from a JSON file.
The proposal is created on-chain and remains pending approval.

Usage:
  ./scripts/propose_template_from_json.sh --file <template_or_example.json> [options]

Options:
  --file <path>                 JSON file containing at least template_id and type
  --template-id <u64>           Optional override when JSON does not include template_id
  --env-file <path>             Optional env file to load first (default: ./ .env if present)
  --controller <addr_or_alias>  Controller address/alias that owns controller cap
  --proposal-timeout-ms <u64>   Proposal timeout in milliseconds (default: 600000)
  --gas-budget <u64>            Gas budget (default: 50000000)
  --system-pkg <id>             System package id
  --state-id <id>               Oracle state object id
  --controller-cap-id <id>      Oracle controller cap id
  --clock-id <id>               Clock object id (default: 0x6)
  -h, --help                    Show help

JSON accepted fields:
  Required:
    template_id, type
  Optional (top-level or under "template"):
    is_enabled
    base_price_iota
    max_input_bytes
    max_output_bytes
    included_download_bytes
    price_per_download_byte_iota
    allow_storage
    min_retention_days
    max_retention_days
    price_per_retention_day_iota

Examples:
  ./scripts/propose_template_from_json.sh --file src/tasks/examples/task_STORAGE.json
  ./scripts/propose_template_from_json.sh --file ./my_template.json --controller 0xabc...
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --file" >&2; usage; exit 1; }
      TEMPLATE_JSON="$1"
      ;;
    --template-id)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --template-id" >&2; usage; exit 1; }
      TEMPLATE_ID_OVERRIDE="$1"
      ;;
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
    --proposal-timeout-ms)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --proposal-timeout-ms" >&2; usage; exit 1; }
      PROPOSAL_TIMEOUT_MS="$1"
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
    --controller-cap-id)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --controller-cap-id" >&2; usage; exit 1; }
      CONTROLLER_CAP_ID="$1"
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
  [[ -f "$ENV_FILE" ]] || { echo "[error] env file not found: $ENV_FILE" >&2; exit 1; }
  set -a
  # Load env file safely even if it has CRLF line endings.
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$ENV_FILE")
  set +a
fi

SYSTEM_PKG="${SYSTEM_PKG:-${ORACLE_SYSTEM_PACKAGE_ID:-}}"
STATE_ID="${STATE_ID:-${ORACLE_STATE_ID:-}}"
CONTROLLER_CAP_ID="${CONTROLLER_CAP_ID:-${ORACLE_CONTROLLER_CAP_ID:-}}"
if [[ -z "$CONTROLLER_ADDRESS_OR_ALIAS" ]]; then
  CONTROLLER_ADDRESS_OR_ALIAS="${ORACLE_CONTROLLER_ADDRESS:-${CONTROLLER_ADDRESS_OR_ALIAS:-}}"
fi

[[ -n "$TEMPLATE_JSON" ]] || { echo "[error] --file is required" >&2; usage; exit 1; }
[[ -f "$TEMPLATE_JSON" ]] || { echo "[error] JSON file not found: $TEMPLATE_JSON" >&2; exit 1; }
[[ -z "$TEMPLATE_ID_OVERRIDE" || "$TEMPLATE_ID_OVERRIDE" =~ ^[0-9]+$ ]] || { echo "[error] --template-id must be numeric" >&2; exit 1; }
[[ -n "$SYSTEM_PKG" ]] || { echo "[error] missing SYSTEM_PKG / ORACLE_SYSTEM_PACKAGE_ID" >&2; exit 1; }
[[ -n "$STATE_ID" ]] || { echo "[error] missing STATE_ID / ORACLE_STATE_ID" >&2; exit 1; }
[[ -n "$CONTROLLER_CAP_ID" ]] || { echo "[error] missing CONTROLLER_CAP_ID / ORACLE_CONTROLLER_CAP_ID" >&2; exit 1; }
[[ -n "$CONTROLLER_ADDRESS_OR_ALIAS" ]] || {
  echo "[error] missing controller address/alias (use --controller or CONTROLLER_ADDRESS_OR_ALIAS env)" >&2
  exit 1
}
[[ "$PROPOSAL_TIMEOUT_MS" =~ ^[0-9]+$ ]] || { echo "[error] --proposal-timeout-ms must be numeric" >&2; exit 1; }
[[ "$GAS_BUDGET" =~ ^[0-9]+$ ]] || { echo "[error] --gas-budget must be numeric" >&2; exit 1; }

command -v iota >/dev/null 2>&1 || { echo "[error] iota CLI not found" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[error] node not found" >&2; exit 1; }

FULL_JSON_PATH="$(cd "$(dirname "$TEMPLATE_JSON")" && pwd)/$(basename "$TEMPLATE_JSON")"

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

PARSED_TEMPLATE="$(
  node -e '
const fs = require("fs");
const file = process.argv[1];
const templateIdOverrideRaw = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const j = JSON.parse(raw);
const t = (j && typeof j.template === "object" && !Array.isArray(j.template)) ? j.template : {};
const pick = (k) => (t[k] ?? j[k]);
const toInt = (v, d) => {
  if (v === undefined || v === null || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.trunc(n);
};
const taskType = String(pick("type") ?? "").trim();
if (!taskType) {
  throw new Error("JSON must contain non-empty type");
}
let templateId = toInt(pick("template_id"), NaN);
const templateIdOverride = toInt(templateIdOverrideRaw, NaN);
if (Number.isFinite(templateIdOverride) && templateIdOverride > 0) {
  templateId = templateIdOverride;
}
if (!Number.isFinite(templateId) || templateId <= 0) {
  throw new Error(`Cannot resolve template_id for type=${taskType}. Add template_id in JSON or pass --template-id.`);
}
const isStorage = taskType.toUpperCase() === "STORAGE";
const allowStorage = toInt(pick("allow_storage"), isStorage ? 1 : 0);
const minRetention = toInt(pick("min_retention_days"), allowStorage ? 1 : 0);
const maxRetention = toInt(pick("max_retention_days"), allowStorage ? 365 : 0);
const vals = [
  templateId,
  taskType,
  toInt(pick("is_enabled"), 1),
  toInt(pick("base_price_iota"), isStorage ? 500000000 : 1000000000),
  toInt(pick("max_input_bytes"), 8192),
  toInt(pick("max_output_bytes"), isStorage ? 10485760 : 8192),
  toInt(pick("included_download_bytes"), isStorage ? 10485760 : 8192),
  toInt(pick("price_per_download_byte_iota"), 0),
  allowStorage,
  minRetention,
  maxRetention,
  toInt(pick("price_per_retention_day_iota"), allowStorage ? 10000 : 0),
];
process.stdout.write(vals.join(" "));
  ' "$FULL_JSON_PATH" "$TEMPLATE_ID_OVERRIDE"
)"
read -r TEMPLATE_ID TASK_TYPE IS_ENABLED BASE_PRICE MAX_INPUT MAX_OUTPUT INCLUDED_DOWNLOAD PRICE_PER_DOWNLOAD ALLOW_STORAGE MIN_RETENTION MAX_RETENTION PRICE_PER_RETENTION <<<"$PARSED_TEMPLATE"

echo "[info] project: ${PROJECT_DIR}"
echo "[info] json: ${FULL_JSON_PATH}"
echo "[info] controller: ${CONTROLLER_ADDRESS_OR_ALIAS}"
echo "[info] system_pkg: ${SYSTEM_PKG}"
echo "[info] state_id: ${STATE_ID}"
echo "[info] controller_cap_id: ${CONTROLLER_CAP_ID}"
echo "[info] clock_id: ${CLOCK_ID}"
echo "[info] proposal_timeout_ms: ${PROPOSAL_TIMEOUT_MS}"
echo "[info] gas_budget: ${GAS_BUDGET}"
echo "[info] template_id: ${TEMPLATE_ID}"
echo "[info] task_type: ${TASK_TYPE}"
echo "[info] is_enabled: ${IS_ENABLED}"
echo "[info] base_price_iota: ${BASE_PRICE}"
echo "[info] max_input_bytes: ${MAX_INPUT}"
echo "[info] max_output_bytes: ${MAX_OUTPUT}"
echo "[info] included_download_bytes: ${INCLUDED_DOWNLOAD}"
echo "[info] price_per_download_byte_iota: ${PRICE_PER_DOWNLOAD}"
echo "[info] allow_storage: ${ALLOW_STORAGE}"
echo "[info] min_retention_days: ${MIN_RETENTION}"
echo "[info] max_retention_days: ${MAX_RETENTION}"
echo "[info] price_per_retention_day_iota: ${PRICE_PER_RETENTION}"

iota client switch --address "$CONTROLLER_ADDRESS_OR_ALIAS" >/dev/null

iota client ptb \
  --move-call "${SYSTEM_PKG}::systemState::propose_task_template_upsert" \
  "@${CONTROLLER_CAP_ID}" \
  "@${STATE_ID}" \
  "@${CLOCK_ID}" \
  "$PROPOSAL_TIMEOUT_MS" \
  "$TEMPLATE_ID" \
  "\"$TASK_TYPE\"" \
  "$IS_ENABLED" \
  "$BASE_PRICE" \
  "$MAX_INPUT" \
  "$MAX_OUTPUT" \
  "$INCLUDED_DOWNLOAD" \
  "$PRICE_PER_DOWNLOAD" \
  "$ALLOW_STORAGE" \
  "$MIN_RETENTION" \
  "$MAX_RETENTION" \
  "$PRICE_PER_RETENTION" \
  --gas-budget "$GAS_BUDGET"

PROPOSAL_ID="$(current_proposal_counter || true)"
echo "[ok] proposal created for template_id=${TEMPLATE_ID}. Awaiting approvals."
[[ -n "${PROPOSAL_ID}" ]] && echo "[ok] proposal_id=${PROPOSAL_ID}"
