IOTA Distributed Oracle - devnet bootstrap

Current devnet deploy
- ORACLE_TASKS_PACKAGE_ID=0xfb0a7c8cb955f400ecf735ce446e9d0da45c011c68240545def05937dd8d2f1b
- ORACLE_SYSTEM_PACKAGE_ID=0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a8306dea2
- ORACLE_STATE_ID=0xec7b66ccf663491e568daa3599ed3771f0886769eb5bf86f1876d91fa4cecfcf
- ORACLE_TREASURY_ID=0x54f1986413c9ac36e6920a0dff1634d71746f45b502ddbd042f43b23191fbd20
- CONTROLLER_CAP_ID=0xa60b03ad45ed46c564ba1620b0347500b34cd082064004f4521cff0c53672dfd
- IOTA_CLOCK_ID=0x6

1) Update node .env
Set these values in the node project:

export ORACLE_TASKS_PACKAGE_ID="0xfb0a7c8cb955f400ecf735ce446e9d0da45c011c68240545def05937dd8d2f1b"
export ORACLE_SYSTEM_PACKAGE_ID="0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a8306dea2"
export ORACLE_STATE_ID="0xec7b66ccf663491e568daa3599ed3771f0886769eb5bf86f1876d91fa4cecfcf"
export ORACLE_TREASURY_ID="0x54f1986413c9ac36e6920a0dff1634d71746f45b502ddbd042f43b23191fbd20"
export CONTROLLER_CAP_ID="0xa60b03ad45ed46c564ba1620b0347500b34cd082064004f4521cff0c53672dfd"
export IOTA_CLOCK_ID="0x6"

2) Register oracle nodes
The registration script targets the current systemState package and shared State object.
Important: `oracle_addr` is a Move `address`, not an object ID. Do not prefix it with `@`.

bash register_oracle_nodes_dev_fixed.sh

Optional override:
export ACCEPTED_TEMPLATE_IDS='[1,2,3,4]'

3) Create or update task templates
The template governance script uses the current `propose_task_template_upsert` and `approve_task_template_proposal` flow.
Set the controller address or alias before running it:

export CONTROLLER_ADDRESS_OR_ALIAS="0x59dadd46e10bc3d890a0d20aa3fd1a460110eab5d368922ac1db02883434cc43"
bash setup_oracle_job_templates_fixed.sh

Examples:
bash setup_oracle_job_templates_fixed.sh --only storage
bash setup_oracle_job_templates_fixed.sh --only random
bash setup_oracle_job_templates_fixed.sh --only commodity
bash setup_oracle_job_templates_fixed.sh --only weather

4) Manual STORAGE template proposal example

export SYSTEM_PKG="0x9d29664cf826bbabf906e87ef4b88b76560286634c44f834c8ad306a8306dea2"
export STATE_ID="0xec7b66ccf663491e568daa3599ed3771f0886769eb5bf86f1876d91fa4cecfcf"
export CONTROLLER_CAP_ID="0xa60b03ad45ed46c564ba1620b0347500b34cd082064004f4521cff0c53672dfd"
export CLOCK_ID="0x6"
export CONTROLLER_ADDRESS_OR_ALIAS="0x59dadd46e10bc3d890a0d20aa3fd1a460110eab5d368922ac1db02883434cc43"
export NODE1_ALIAS="oracle-node-1"
export NODE2_ALIAS="oracle-node-2"
export PROPOSAL_TIMEOUT_MS="600000"
export GAS_BUDGET="50000000"

iota client switch --address "$CONTROLLER_ADDRESS_OR_ALIAS"
iota client ptb   --move-call "${SYSTEM_PKG}::systemState::propose_task_template_upsert"   "@${CONTROLLER_CAP_ID}"   "@${STATE_ID}"   "@${CLOCK_ID}"   "$PROPOSAL_TIMEOUT_MS"   "4"   '"STORAGE"'   "1"   "0"   "21323200"   "8192"   "10485760"   "10485760"   "0"   "1"   "30"   "365"   "347034"   --gas-budget "$GAS_BUDGET"

iota client switch --address "$NODE1_ALIAS"
iota client ptb   --move-call "${SYSTEM_PKG}::systemState::approve_task_template_proposal"   "@${STATE_ID}"   "@${CLOCK_ID}"   --gas-budget "$GAS_BUDGET"

iota client switch --address "$NODE2_ALIAS"
iota client ptb   --move-call "${SYSTEM_PKG}::systemState::approve_task_template_proposal"   "@${STATE_ID}"   "@${CLOCK_ID}"   --gas-budget "$GAS_BUDGET"
