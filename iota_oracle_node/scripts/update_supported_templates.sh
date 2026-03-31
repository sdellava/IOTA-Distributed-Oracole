#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

NODE_ID="${NODE_ID:-1}"
ACTION=""
TEMPLATE_ID=""
BASE_TEMPLATES="${BASE_TEMPLATES:-}"
ENV_FILE=""

usage() {
  cat <<'EOF'
Add/remove one template id from the node accepted templates list.
The final list is then pushed on-chain via "set-accepted-templates".

Usage:
  ./scripts/update_supported_templates.sh --action add|remove --template-id <id> [--node <node_id>] [--base-templates "1,2,3,4"] [--env-file ./.env]

Examples:
  ./scripts/update_supported_templates.sh --action add --template-id 7 --node 1
  ./scripts/update_supported_templates.sh --action remove --template-id 4 --node 2 --base-templates "1,2,3,4,7"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --action)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --action" >&2; usage; exit 1; }
      ACTION="$1"
      ;;
    --template-id)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --template-id" >&2; usage; exit 1; }
      TEMPLATE_ID="$1"
      ;;
    --node)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --node" >&2; usage; exit 1; }
      NODE_ID="$1"
      ;;
    --base-templates)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --base-templates" >&2; usage; exit 1; }
      BASE_TEMPLATES="$1"
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

[[ "$ACTION" == "add" || "$ACTION" == "remove" ]] || {
  echo "[error] --action must be add or remove" >&2
  usage
  exit 1
}
[[ "$TEMPLATE_ID" =~ ^[0-9]+$ ]] || { echo "[error] --template-id must be numeric" >&2; exit 1; }
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"

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

if [[ -z "${BASE_TEMPLATES}" ]]; then
  BASE_TEMPLATES="${ORACLE_ACCEPTED_TEMPLATE_IDS:-}"
fi
if [[ -z "${BASE_TEMPLATES}" ]]; then
  BASE_TEMPLATES="$(read_env_value "ORACLE_ACCEPTED_TEMPLATE_IDS" "${ENV_FILE}" || true)"
fi
if [[ -z "${BASE_TEMPLATES}" ]]; then
  BASE_TEMPLATES="1,2,3,4"
fi

CURRENT_LIST="$(normalize_list "$BASE_TEMPLATES")"
TARGET_ID="${TEMPLATE_ID}"

if [[ "$ACTION" == "add" ]]; then
  UPDATED_LIST="$(normalize_list "${CURRENT_LIST},${TARGET_ID}")"
else
  UPDATED_LIST="$(
    echo "${CURRENT_LIST}" \
      | tr ',' '\n' \
      | sed '/^$/d' \
      | awk -v id="${TARGET_ID}" '$0 != id' \
      | sort -n \
      | uniq \
      | paste -sd, -
  )"
fi

[[ -n "${UPDATED_LIST}" ]] || {
  echo "[error] resulting template list is empty; refusing to update on-chain." >&2
  exit 1
}

echo "[info] project: ${PROJECT_DIR}"
echo "[info] node_id: ${NODE_ID}"
echo "[info] action: ${ACTION}"
echo "[info] env_file: ${ENV_FILE}"
echo "[info] base_templates: ${CURRENT_LIST}"
echo "[info] updated_templates: ${UPDATED_LIST}"

cd "${PROJECT_DIR}"
npm run cli -- set-accepted-templates --node "${NODE_ID}" --templates "${UPDATED_LIST}"
write_env_value "ORACLE_ACCEPTED_TEMPLATE_IDS" "${UPDATED_LIST}" "${ENV_FILE}"
echo "[info] ORACLE_ACCEPTED_TEMPLATE_IDS updated in ${ENV_FILE}"
