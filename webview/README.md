# iota_oracle_webview

TypeScript full-stack webview for the IOTA Oracle system.

## What it does

- React frontend for a live oracle dashboard
- Express backend in TypeScript
- Reads on-chain activity through the official IOTA TypeScript SDK
- Executes tasks through local sibling project `../iota_oracle_client`
- Loads JSON examples from local `./examples`

## Dashboard metrics

The page shows:

- active nodes
- known nodes
- inactive known nodes
- task events
- message events
- latest checkpoint
- recent oracle events
- node activity by sender address

## Important note about "active nodes"

Without a dedicated on-chain registry query, the dashboard infers active nodes from recent event senders in configured oracle modules.

That means:

- `active nodes` = unique senders with recent events in the configured time window
- `known nodes` = `ORACLE_NODE_ADDRESSES` from `.env`, if provided
- if `ORACLE_NODE_ADDRESSES` is empty, known nodes are inferred from recent senders only

If `ORACLE_SYSTEM_STATE_ID` is configured, backend tries to read registered nodes from oracle system state and counts active nodes only inside that set. If missing, it falls back to sender-based inference.

## Expected project layout

```text
parent/
  iota_oracle_client/
  iota_oracle_webview/
    examples/
```

Backend assumptions:

- oracle client is at `../iota_oracle_client`
- example JSON files are in local `./examples`

## Configuration

Copy `.env.example` to `.env` and set at least:

```env
PORT=8787
IOTA_RPC_URL=https://api.testnet.iota.cafe
ORACLE_PACKAGE_ID=0xYOUR_PACKAGE_ID
ORACLE_SYSTEM_STATE_ID=0xYOUR_SYSTEM_STATE_ID
ORACLE_TASK_MODULE=oracle_tasks
ORACLE_MESSAGE_MODULE=oracle_messages
ACTIVE_WINDOW_MINUTES=15
EVENT_FETCH_LIMIT=100
ORACLE_NODE_ADDRESSES=
ORACLE_CLIENT_DIR=../iota_oracle_client
ORACLE_EXAMPLES_DIR=examples
```

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

Starts:

- Vite frontend on `http://localhost:5173`
- Express backend on `http://localhost:8787`

Vite proxies `/api/*` to backend.

## Production-style run

Build frontend:

```bash
npm run build
```

Start backend:

```bash
npm run start
```

Backend serves `dist/` and API.

## Task execution flow

When submitting a task from the web page:

1. backend writes task JSON to a temporary file
2. backend runs:

```bash
npm run create -- <temp-task-file>
```

inside `../iota_oracle_client`, while examples shown in UI are read from local `./examples`.

3. UI shows stdout, stderr, and exit code

## Files worth touching next

- `server/services/oracleStatus.ts` for stricter on-chain metrics
- `server/services/oracleClient.ts` if client command changes
- `src/App.tsx` for UI changes

## Suggested next improvement

A good next step is a dedicated backend adapter that reads real oracle shared objects (not only recent events). That enables exact counts for registered nodes, pending tasks, completed tasks, and per-task state.

## Note on `.env`

Backend loads `.env` using `dotenv`. If `ORACLE_PACKAGE_ID` is empty, verify commands are run from `iota_oracle_webview` project root.

## Notes

- `ORACLE_NODE_ADDRESSES` is optional. If empty, dashboard infers nodes from recent event senders.
- On Windows backend runs oracle client via `cmd.exe /c npm run create -- <taskfile>` because `npm.cmd` should not be spawned directly without a shell (per Node.js docs).

## Examples directory

By default backend reads example tasks from:

```text
./examples
```

relative to `iota_oracle_webview` root.

You can override with:

```env
ORACLE_EXAMPLES_DIR=examples
```

For backward compatibility, `ORACLE_CLIENT_EXAMPLES_DIR` is still accepted, but recommended variable is `ORACLE_EXAMPLES_DIR`.
