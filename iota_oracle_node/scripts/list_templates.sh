#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[error] line $LINENO: command failed: $BASH_COMMAND" >&2' ERR

SHOW_PENDING=0
PENDING_ONLY=0
JSON_OUTPUT=0

usage() {
  cat <<'EOF'
List approved templates for the oracle state.
Optionally include the active pending proposal with current approvals.

Usage:
  ./scripts/list_templates.sh [--pending] [--pending-only] [--json]

Options:
  --pending       Show approved templates and pending proposal (if any)
  --pending-only  Show only pending proposal details
  --json          Print machine-readable JSON output
  -h, --help      Show this help

Examples:
  ./scripts/list_templates.sh
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

echo "[info] project: ${PROJECT_DIR}"
cd "${PROJECT_DIR}"
npm exec tsx src/tools/listTemplates.ts "${ARGS[@]}"
