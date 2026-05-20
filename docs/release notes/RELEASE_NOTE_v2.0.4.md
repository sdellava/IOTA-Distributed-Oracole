# Release Note - v2.0.4

Version `v2.0.4` introduces the direct one-shot task creation flow and aligns
the client, webview, pricing documentation and testnet deployment with that
model.

## Direct one-shot tasks

One-shot task creation now uses the existing `oracle_tasks` package entry:

```move
oracle_tasks::create_and_submit_direct_task
```

The direct path creates the task, assigns registered oracle nodes immediately
and submits run `1` in the same transaction. It does not enter the scheduler
queue and it does not pay the template scheduler fee.

## Scheduled tasks

Scheduled tasks continue to use:

```move
oracle_tasks::create_task
```

The client and webview keep the modes separate:

- no interval, `interval_ms = 0`, or a one-run window creates a direct one-shot
  task;
- an interval of at least 5 minutes with at least two effective runs creates a
  scheduled task handled by scheduler task `0`.

## Client examples

The client documentation now includes copyable examples for both modes.

Direct one-shot:

```bash
cd client
npm run create -- examples/task_weather.json
```

Scheduled transaction preparation:

```bash
cd client
npm run create -- prepare-task-schedule-webview examples/task_weather.json examples/schedule_5m_two_runs.json 0xYOUR_WALLET_ADDRESS
```

## Pricing and storage template

The webview pricing page now shows the complete task cost breakdown with runtime
parameters for requested nodes, declared download bytes, retention days and
scheduled runs.

For storage tasks, the example template now uses fixed 30-day retention:

```text
min_retention_days = 30
max_retention_days = 30
```

The client validates `STORAGE` task creation with `retention_days = 30`.

## Testnet deployment

The testnet kit was published for this version. The current package IDs are:

```text
TESTNET_ORACLE_VALIDATOR_CAPS_PACKAGE_ID=0xa20f8117eccd5d003991d3fe9fa2a440841a74d96017e3e6af0024b524d9c09b
TESTNET_ORACLE_SYSTEM_PACKAGE_ID=0x55a6b6848a5a343a8ad5ec5db46a93b15011bc3e50fd164e03d996f1aa317425
TESTNET_ORACLE_TASKS_PACKAGE_ID=0x9f995808cd2cd8cee26c1b4fdc7f3b45d578ebd13da0f41d32d7698572a3a77f
TESTNET_ORACLE_SCHEDULER_PACKAGE_ID=0x55fe1e57b275a5a774ac54c0c63aa86451821276b17e3e4d62b16f6b4369d858
```
