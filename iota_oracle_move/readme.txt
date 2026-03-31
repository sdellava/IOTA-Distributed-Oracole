bash register_oracle_nodes_dev.sh

# This is the address that owns the Oracle controller cap
export CONTROLLER_ADDRESS_OR_ALIAS=0xad71e9f72902bbfd0cbbc3f1d482cae8fbe1606849a539eaf4c2c14b7febd238
bash setup_oracle_task_templates.sh

To change/create a template:

export SYSTEM_PKG="0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a8306dea2"
export STATE_ID="0xec7b66ccf663491e568daa3599ed3771f0886769eb5bf86f1876d91fa4cecfcf"
export CONTROLLER_CAP_ID="0xa60b03ad45ed46c564ba1620b0347500b34cd082064004f4521cff0c53672dfd"
export CLOCK_ID="0x6"

export CONTROLLER_ADDRESS_OR_ALIAS="0x59dadd46e10bc3d890a0d20aa3fd1a460110eab5d368922ac1db02883434cc43"
export NODE1_ALIAS="oracle-node-1"
export NODE2_ALIAS="oracle-node-2"

export PROPOSAL_TIMEOUT_MS="600000"
export GAS_BUDGET="50000000"

# Propose new template content
iota client switch --address "$CONTROLLER_ADDRESS_OR_ALIAS"

iota client ptb \
  --move-call "${SYSTEM_PKG}::systemState::propose_task_template_upsert" \
  "@${CONTROLLER_CAP_ID}" \
  "@${STATE_ID}" \
  "@${CLOCK_ID}" \
  "$PROPOSAL_TIMEOUT_MS" \
  "4" \
  '"STORAGE"' \
  "1" \
  "500000" \
  "8192" \
  "10485760" \
  "10485760" \
  "0" \
  "1" \
  "1" \
  "365" \
  "10000" \
  --gas-budget "$GAS_BUDGET"

# Approve from node 1
iota client switch --address "$NODE1_ALIAS"

# Resolve proposal id (latest created)
export PROPOSAL_ID="$(iota client object "${STATE_ID}" --json | jq -r '.. | .template_proposal_id? // empty' | tail -n1)"

iota client ptb \
  --move-call "${SYSTEM_PKG}::systemState::approve_task_template_proposal" \
  "@${STATE_ID}" \
  "@${CLOCK_ID}" \
  "$PROPOSAL_ID" \
  --gas-budget "$GAS_BUDGET"

# Approve from node 2
iota client switch --address "$NODE2_ALIAS"

iota client ptb \
  --move-call "${SYSTEM_PKG}::systemState::approve_task_template_proposal" \
  "@${STATE_ID}" \
  "@${CLOCK_ID}" \
  "$PROPOSAL_ID" \
  --gas-budget "$GAS_BUDGET"
