# iota-oracle-node v3.1

Node runtime for the IOTA distributed oracle.

## Key update

`STORAGE` tasks are now **IPFS-only**:
- no local payload persistence
- no local manifest files
- no retention cleanup loop
- no `cleanup-expired-storage` CLI command

If `IPFS_ENABLED` is false, `STORAGE` task execution fails by design.

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

## Start a node

```bash
npm run daemon -- --node 1
```

or:

```bash
npm run dev -- --node 1
```

On non-dev networks (`IOTA_NETWORK` not `dev`/`devnet`/`local`/`localnet`), registration is forced to `systemState::register_oracle_node` and requires a `systemState::DelegatedControllerCap` + signer key.
If `DELEGATED_CONTROLLER_CAP_ID` is not configured, node auto-detects an owned `systemState::DelegatedControllerCap` from the signer address.

## CLI commands

```bash
npm run cli -- accept-template-proposal --node 1 [--template-id 4]
npm run cli -- set-accepted-templates --node 1 --templates 1,2,3,4,5,6,7,8
```

## Node manager scripts

```bash
bash ./scripts/approve_template_by_id.sh --proposal-id 12 --node 1
bash ./scripts/approve_template_by_id.sh --template-id 4 --node 1
bash ./scripts/propose_template_from_json.sh --file src/tasks/examples/task_STORAGE.json --controller 0xYOUR_CONTROLLER_ADDRESS
bash ./scripts/update_supported_templates.sh --action add --template-id 7 --node 1
bash ./scripts/update_supported_templates.sh --action remove --template-id 4 --node 1
bash ./scripts/list_templates.sh
bash ./scripts/list_templates.sh --pending
```

`update_supported_templates.sh` also syncs `ORACLE_ACCEPTED_TEMPLATE_IDS` in `.env` after a successful on-chain update.

## STORAGE task behavior

For `STORAGE` tasks, the node:
- resolves payload content (URL, base64, text, JSON)
- validates hashes/size constraints
- uploads bytes to IPFS
- returns deterministic canonical JSON including `ipfs_cid`, hash, mime type, size, and retention days

No local file is written.

## Required IPFS env

```env
IPFS_ENABLED=true
IPFS_API_URL=https://api-ipfs.objectid.io
IPFS_PIN=true
IPFS_CID_VERSION=1
```

Plus one auth method (bearer token, basic auth, or API key/secret).

## Docker

```bash
docker compose up --build -d
```

Compose now persists only:
- `./keys`

## Notes

- On-chain retention fields are still part of task economics/validation.
- Local retention lifecycle has been fully removed from node runtime.
