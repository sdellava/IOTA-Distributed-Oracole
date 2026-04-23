#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEBVIEW_EXAMPLES_DIR="$(cd "${PROJECT_DIR}/../webview/examples" && pwd)"

usage() {
  cat <<'EOF'
Test task templates from webview/examples.

Usage:
  ./scripts/test_webview_templates.sh
  ./scripts/test_webview_templates.sh --list
  ./scripts/test_webview_templates.sh --template task_weather.json --node 1
  ./scripts/test_webview_templates.sh --all --node 1

Options:
  --list               List available templates
  --all                Run all templates
  --template <value>   File name, index, template_id, or task type
  --node <id>          Node id to pass to npm run test (default: NODE_ID or 1)
  -h, --help           Show this help
EOF
}

LIST_ONLY=0
RUN_ALL=0
SELECTOR=""
NODE_ID="${NODE_ID:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)
      LIST_ONLY=1
      ;;
    --all)
      RUN_ALL=1
      ;;
    --template)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --template" >&2; usage; exit 1; }
      SELECTOR="$1"
      ;;
    --template=*)
      SELECTOR="${1#--template=}"
      ;;
    --node)
      shift
      [[ $# -gt 0 ]] || { echo "[error] missing value for --node" >&2; usage; exit 1; }
      NODE_ID="$1"
      ;;
    --node=*)
      NODE_ID="${1#--node=}"
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

shopt -s nullglob
TEMPLATE_FILES=("${WEBVIEW_EXAMPLES_DIR}"/*.json)
shopt -u nullglob
[[ ${#TEMPLATE_FILES[@]} -gt 0 ]] || { echo "[error] no templates found in ${WEBVIEW_EXAMPLES_DIR}" >&2; exit 1; }

describe_template() {
  local file="$1"
  node -e "const fs=require('fs'); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,'utf8')); const id=j.template_id ?? j.templateId ?? '?'; const type=j.type ?? '?'; process.stdout.write(String(id)+'|'+String(type));" "$file"
}

print_list() {
  local idx=1
  echo "Available webview task templates:"
  for file in "${TEMPLATE_FILES[@]}"; do
    local meta
    meta="$(describe_template "$file")"
    local template_id="${meta%%|*}"
    local task_type="${meta#*|}"
    echo "  ${idx}. $(basename "$file") (template_id=${template_id}, ${task_type})"
    idx=$((idx + 1))
  done
}

find_template() {
  local selector="$1"
  local idx=1
  local raw="${selector,,}"

  for file in "${TEMPLATE_FILES[@]}"; do
    local name
    name="$(basename "$file")"
    local meta
    meta="$(describe_template "$file")"
    local template_id="${meta%%|*}"
    local task_type="${meta#*|}"

    if [[ "$selector" =~ ^[0-9]+$ && "$selector" -eq "$idx" ]]; then
      echo "$file"
      return 0
    fi
    if [[ "$selector" =~ ^[0-9]+$ && "$template_id" == "$selector" ]]; then
      echo "$file"
      return 0
    fi
    if [[ "${name,,}" == "$raw" || "${name,,}" == *"$raw"* ]]; then
      echo "$file"
      return 0
    fi
    if [[ "${task_type,,}" == "$raw" || "${task_type,,}" == *"$raw"* ]]; then
      echo "$file"
      return 0
    fi

    idx=$((idx + 1))
  done

  return 1
}

run_template() {
  local file="$1"
  local name
  name="$(basename "$file")"
  local meta
  meta="$(describe_template "$file")"
  local template_id="${meta%%|*}"
  local task_type="${meta#*|}"

  echo
  echo ">>> Running ${name}"
  local output
  set +e
  output="$(npm run test -- "$file" --node "$NODE_ID" 2>&1)"
  local exit_code=$?
  set -e
  printf '%s\n' "$output"

  local validity="VALID"
  local feedback=()

  if [[ $exit_code -ne 0 ]]; then
    validity="INVALID"
    feedback+=("test command failed")
  fi
  [[ "$output" == *"handler_found: yes"* ]] || { validity="INVALID"; feedback+=("handler not found"); }
  [[ "$output" == *"template_policy_check: ok"* ]] || { validity="INVALID"; feedback+=("template policy check failed"); }
  [[ "$output" == *"execution_status: ok"* ]] || { validity="INVALID"; feedback+=("task execution did not complete successfully"); }

  local normalized_length
  normalized_length="$(printf '%s\n' "$output" | sed -n 's/^normalized_length: //p' | tail -n 1)"
  if [[ -z "$normalized_length" || ! "$normalized_length" =~ ^[0-9]+$ || "$normalized_length" -le 0 ]]; then
    validity="INVALID"
    feedback+=("normalized output is empty")
  fi

  if [[ "$validity" == "VALID" && "$output" == *"template_accepted_by_env: no"* ]]; then
    validity="WARNING"
    feedback+=("template not accepted by ORACLE_ACCEPTED_TEMPLATE_IDS in current env")
  fi

  echo
  echo "=== ${validity} :: ${name} (template_id=${template_id}, ${task_type}) ==="
  echo "exit_code: ${exit_code}"
  echo "normalized_length: ${normalized_length:-0}"
  echo "feedback:"
  if [[ ${#feedback[@]} -eq 0 ]]; then
    echo "- local execution completed and returned a non-empty normalized result"
  else
    for item in "${feedback[@]}"; do
      echo "- ${item}"
    done
  fi

  RUN_TEMPLATE_VALIDITY="$validity"
}

cd "${PROJECT_DIR}"

if [[ "${LIST_ONLY}" -eq 1 ]]; then
  print_list
  exit 0
fi

SELECTED_FILES=()

if [[ "${RUN_ALL}" -eq 1 ]]; then
  SELECTED_FILES=("${TEMPLATE_FILES[@]}")
elif [[ -n "${SELECTOR}" ]]; then
  match="$(find_template "${SELECTOR}")" || { echo "[error] template not found: ${SELECTOR}" >&2; exit 1; }
  SELECTED_FILES=("${match}")
else
  print_list
  echo
  read -r -p "Choose a template number/name, 'all' to run all, or 'q' to quit: " choice
  choice="$(printf '%s' "$choice" | xargs)"
  if [[ -z "$choice" || "${choice,,}" == "q" || "${choice,,}" == "quit" ]]; then
    echo "No template selected."
    exit 0
  fi
  read -r -p "Node id to use [${NODE_ID}]: " node_input
  node_input="$(printf '%s' "$node_input" | xargs)"
  if [[ -n "$node_input" ]]; then
    NODE_ID="$node_input"
    [[ "$NODE_ID" =~ ^[0-9]+$ ]] || { echo "[error] node id must be numeric" >&2; exit 1; }
  fi
  if [[ "${choice,,}" == "all" ]]; then
    SELECTED_FILES=("${TEMPLATE_FILES[@]}")
  else
    match="$(find_template "${choice}")" || { echo "[error] template not found: ${choice}" >&2; exit 1; }
    SELECTED_FILES=("${match}")
  fi
fi

echo
echo "Using node_id=${NODE_ID}"
echo "Project dir: ${PROJECT_DIR}"
echo "Webview examples dir: ${WEBVIEW_EXAMPLES_DIR}"

valid_count=0
warning_count=0
invalid_count=0

for file in "${SELECTED_FILES[@]}"; do
  run_template "$file"
  case "$RUN_TEMPLATE_VALIDITY" in
    VALID)
      valid_count=$((valid_count + 1))
      ;;
    WARNING)
      warning_count=$((warning_count + 1))
      ;;
    *)
      invalid_count=$((invalid_count + 1))
      ;;
  esac
done

if [[ ${#SELECTED_FILES[@]} -gt 1 ]]; then
  echo
  echo "=== SUMMARY ==="
  echo "valid: ${valid_count}"
  echo "warning: ${warning_count}"
  echo "invalid: ${invalid_count}"
fi

[[ "${invalid_count}" -eq 0 ]]
