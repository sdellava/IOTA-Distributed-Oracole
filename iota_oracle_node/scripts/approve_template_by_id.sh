#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

NODE_ID="${NODE_ID:-1}"
TEMPLATE_ID=""

usage() {
  cat <<'EOF'
Approve active template proposal, asserting the expected template id.

Usage:
  ./scripts/approve_template_by_id.sh --template-id <id> [--node <node_id>]

Examples:
  ./scripts/approve_template_by_id.sh --template-id 4
  ./scripts/approve_template_by_id.sh --template-id 8 --node 2
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

[[ -n "$TEMPLATE_ID" ]] || { echo "[error] --template-id is required" >&2; usage; exit 1; }
[[ "$TEMPLATE_ID" =~ ^[0-9]+$ ]] || { echo "[error] --template-id must be numeric" >&2; exit 1; }
[[ "$NODE_ID" =~ ^[0-9]+$ ]] || { echo "[error] --node must be numeric" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[info] project: ${PROJECT_DIR}"
echo "[info] node_id: ${NODE_ID}"
echo "[info] template_id: ${TEMPLATE_ID}"

cd "${PROJECT_DIR}"
npm run cli -- accept-template-proposal --node "${NODE_ID}" --template-id "${TEMPLATE_ID}"

