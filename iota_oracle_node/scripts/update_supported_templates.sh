#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

NODE_ID="${NODE_ID:-1}"
ENV_FILE=""
TEMPLATES_RAW=""

usage() {
  cat <<'EOF'
Interactive update of node supported templates.
The selected list replaces accepted_template_ids on-chain.

Usage:
  ./scripts/update_supported_templates.sh [--node <id>] [--env-file ./.env]
  ./scripts/update_supported_templates.sh [--node <id>] --templates "4,5,6"

Options:
  --node <id>          Node id (default: 1)
  --env-file <path>    Env file (default: ./ .env)
  --templates <csv>    Non-interactive mode (example: "4,5,6")
  -h, --help           Show help
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
    --templates)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --templates" >&2; usage; exit 1; }
      TEMPLATES_RAW="$1"
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

normalize_list() {
  local raw="$1"
  echo "$raw" \
    | tr '; ' ',,' \
    | tr -s ',' '\n' \
    | sed '/^$/d' \
    | awk '/^[0-9]+$/' \
    | sort -n \
    | uniq \
    | paste -sd, -
}

read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  awk -F= -v k="$key" '
    /^[[:space:]]*#/ { next }
    $1 == k {
      v = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      print v
      exit
    }
  ' "$file"
}

write_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  if [[ -f "$file" ]] && grep -qE "^[[:space:]]*${key}=" "$file"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { done = 0 }
      {
        if (!done && $0 ~ "^[[:space:]]*" k "=") {
          print k "=" v
          done = 1
        } else {
          print $0
        }
      }
      END {
        if (!done) print k "=" v
      }
    ' "$file" > "${file}.tmp"
    mv "${file}.tmp" "$file"
  else
    {
      [[ -f "$file" ]] && cat "$file"
      [[ -s "$file" ]] && echo
      echo "${key}=${value}"
    } > "${file}.tmp"
    mv "${file}.tmp" "$file"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"

if [[ -f "$ENV_FILE" ]]; then
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
PREF_KEY=""
if [[ -n "$NET_PREFIX" ]]; then
  PREF_KEY="${NET_PREFIX}_ORACLE_ACCEPTED_TEMPLATE_IDS"
fi

echo "[info] project: ${PROJECT_DIR}"
echo "[info] node_id: ${NODE_ID}"
echo "[info] env_file: ${ENV_FILE}"
[[ -n "$NETWORK_RAW" ]] && echo "[info] network: ${NETWORK_RAW}"

JSON="$(cd "${PROJECT_DIR}" && npm exec -- tsx src/tools/listTemplates.ts --json)"
mapfile -t CANDIDATES < <(printf "%s" "$JSON" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const approved = Array.isArray(data?.approvedTemplates) ? data.approvedTemplates : [];
const pending = Array.isArray(data?.pendingProposals) ? data.pendingProposals : [];
const map = new Map();
for (const t of approved) {
  const id = Number(t?.templateId);
  if (!Number.isFinite(id) || id <= 0) continue;
  map.set(id, { id, type: String(t?.taskType ?? ""), src: "approved" });
}
for (const p of pending) {
  if (String(p?.kind ?? "") !== "upsert") continue;
  const id = Number(p?.templateId);
  if (!Number.isFinite(id) || id <= 0) continue;
  if (!map.has(id)) map.set(id, { id, type: "", src: "pending-upsert" });
}
for (const x of [...map.values()].sort((a,b)=>a.id-b.id)) {
  process.stdout.write(`${x.id}\t${x.type}\t${x.src}\n`);
}
')

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  echo "[error] no template candidates found on-chain (approved/pending-upsert)." >&2
  exit 1
fi

CURRENT_RAW="${ORACLE_ACCEPTED_TEMPLATE_IDS:-}"
if [[ -z "$CURRENT_RAW" ]] && [[ -n "$PREF_KEY" ]]; then
  CURRENT_RAW="${!PREF_KEY:-}"
fi
if [[ -z "$CURRENT_RAW" ]]; then
  CURRENT_RAW="$(read_env_value ORACLE_ACCEPTED_TEMPLATE_IDS "$ENV_FILE" || true)"
fi
if [[ -z "$CURRENT_RAW" && -n "$PREF_KEY" ]]; then
  CURRENT_RAW="$(read_env_value "$PREF_KEY" "$ENV_FILE" || true)"
fi
CURRENT_LIST="$(normalize_list "$CURRENT_RAW")"

SELECTED_LIST=""
if [[ -n "$TEMPLATES_RAW" ]]; then
  SELECTED_LIST="$(normalize_list "$TEMPLATES_RAW")"
  [[ -n "$SELECTED_LIST" ]] || { echo "[error] --templates produced empty list" >&2; exit 1; }
else
  echo ""
  echo "Available templates:"
  for i in "${!CANDIDATES[@]}"; do
    tid="$(printf "%s" "${CANDIDATES[$i]}" | cut -f1)"
    typ="$(printf "%s" "${CANDIDATES[$i]}" | cut -f2)"
    src="$(printf "%s" "${CANDIDATES[$i]}" | cut -f3)"
    mark=" "
    if [[ -n "$CURRENT_LIST" ]] && echo ",${CURRENT_LIST}," | grep -q ",${tid},"; then
      mark="x"
    fi
    printf "  [%s] id=%s type=%s source=%s\n" "$mark" "$tid" "${typ:--}" "$src"
  done
  echo ""
  echo "Select templates that this node should support:"
  echo "  - one/more selections (example: 1 3 5 or 1,3,5)"
  echo "  - or 'all'"
  read -r -p "> " SEL
  SEL="$(echo "$SEL" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ -n "$SEL" ]] || { echo "[error] empty selection" >&2; exit 1; }

  SELECTED_IDS=()
  if [[ "$SEL" == "all" ]]; then
    for line in "${CANDIDATES[@]}"; do
      SELECTED_IDS+=("$(printf "%s" "$line" | cut -f1)")
    done
  else
    NORM="$(echo "$SEL" | tr ',' ' ')"
    declare -A seen=()
    for token in $NORM; do
      [[ "$token" =~ ^[0-9]+$ ]] || { echo "[error] invalid token: $token" >&2; exit 1; }
      idx=$((token - 1))
      (( idx >= 0 && idx < ${#CANDIDATES[@]} )) || { echo "[error] selection out of range: $token" >&2; exit 1; }
      if [[ -z "${seen[$idx]:-}" ]]; then
        seen[$idx]=1
        SELECTED_IDS+=("$(printf "%s" "${CANDIDATES[$idx]}" | cut -f1)")
      fi
    done
  fi
  SELECTED_LIST="$(normalize_list "$(IFS=,; echo "${SELECTED_IDS[*]}")")"
fi

[[ -n "$SELECTED_LIST" ]] || { echo "[error] selected list is empty (node registration would fail)." >&2; exit 1; }

echo ""
echo "[info] current templates: ${CURRENT_LIST:-<none>}"
echo "[info] selected templates: ${SELECTED_LIST}"
read -r -p "Apply this template support list now? [y/N] " CONFIRM
CONFIRM="$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
  echo "[info] cancelled."
  exit 0
fi

cd "${PROJECT_DIR}"
npm run cli -- set-accepted-templates --node "${NODE_ID}" --templates "${SELECTED_LIST}"

if [[ -n "$ENV_FILE" ]]; then
  write_env_value "ORACLE_ACCEPTED_TEMPLATE_IDS" "${SELECTED_LIST}" "${ENV_FILE}"
  if [[ -n "$PREF_KEY" ]]; then
    write_env_value "$PREF_KEY" "${SELECTED_LIST}" "${ENV_FILE}"
  fi
  echo "[info] updated env: ORACLE_ACCEPTED_TEMPLATE_IDS${PREF_KEY:+ and ${PREF_KEY}}"
fi

echo "[ok] node ${NODE_ID} accepted templates updated."
