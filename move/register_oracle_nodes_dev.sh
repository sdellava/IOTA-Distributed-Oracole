#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[errore] linea $LINENO: comando fallito: $BASH_COMMAND" >&2' ERR

# -----------------------------------------------------------------------------
# Register oracle nodes on devnet for:
# 0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a8306dea2::systemState
# -----------------------------------------------------------------------------
# Note:
# - register_oracle_node_dev(st, oracle_addr, pubkey, accepted_template_ids, ctx)
# - oracle_addr is an address value, NOT an object id, so do NOT prefix it with '@'
# - accepted_template_ids is required by the current Move module
# -----------------------------------------------------------------------------

SYSTEM_PKG="${SYSTEM_PKG:-0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a8306dea2}"
STATE_ID="${STATE_ID:-0xec7b66ccf663491e568daa3599ed3771f0886769eb5bf86f1876d91fa4cecfcf}"
GAS_BUDGET="${GAS_BUDGET:-50000000}"

# Template ids currently used by setup_oracle_job_templates
ACCEPTED_TEMPLATE_IDS="${ACCEPTED_TEMPLATE_IDS:-[1,2,3,4,5,6,7,8]}"
NODE1_ALIAS="${NODE1_ALIAS:-oracle-node-1}"
NODE2_ALIAS="${NODE2_ALIAS:-oracle-node-2}"
NODE3_ALIAS="${NODE3_ALIAS:-oracle-node-3}"

run() {
  echo "> $*"
  "$@"
}

switch_addr() {
  local who="$1"
  echo "[switch] $who"
  run iota client switch --address "$who" >/dev/null
}

register_node() {
  local alias="$1"
  local oracle_addr="$2"
  local pubkey_bytes="$3"
  local accepted_template_ids="${4:-$ACCEPTED_TEMPLATE_IDS}"

  switch_addr "$alias"
  run iota client ptb \
    --make-move-vec "<u8>" "$pubkey_bytes" \
    --assign pubkey \
    --make-move-vec "<u64>" "$accepted_template_ids" \
    --assign accepted \
    --move-call "${SYSTEM_PKG}::systemState::register_oracle_node_dev" \
      "@${STATE_ID}" \
      "@$oracle_addr" \
      pubkey \
      accepted \
    --gas-budget "$GAS_BUDGET" \
    --summary
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "[errore] comando non trovato: $1" >&2; exit 1; }
}

require_cmd iota

echo "[info] env=$(iota client active-env 2>/dev/null | tr -d '\n')"
echo "[info] active-address=$(iota client active-address 2>/dev/null | tr -d '\n')"
echo "[info] SYSTEM_PKG=$SYSTEM_PKG"
echo "[info] STATE_ID=$STATE_ID"
echo "[info] ACCEPTED_TEMPLATE_IDS=$ACCEPTED_TEMPLATE_IDS"

# These are the Ed25519 public key bytes.
register_node \
  "$NODE1_ALIAS" \
  "0x25a10824de130cefbee8ba5802532092410a241768f74ca9f58b06b7679a738c" \
  "[190,212,235,229,87,205,38,143,177,82,30,197,240,223,70,213,112,19,19,2,43,87,13,223,205,83,131,61,202,145,42,2]"

register_node \
  "$NODE2_ALIAS" \
  "0x587a742a0c02366bf05743daa126e168ed70438c122ea99945e71bab14c4ee18" \
  "[65,93,12,132,189,26,78,84,236,177,28,199,138,5,17,173,131,172,155,75,41,76,167,112,100,19,184,218,0,66,243,136]"

register_node \
  "$NODE3_ALIAS" \
  "0x656f24e0e7f4dd6b5860e7183f5dc9116f924e5f6c07a1f86a39f43dc14acc54" \
  "[138,135,89,96,229,2,69,242,147,240,249,225,123,151,229,111,215,254,193,176,26,87,19,52,215,251,35,107,93,199,175,91]"

echo
echo "[ok] oracle nodes registered or updated"