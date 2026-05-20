# Client Task Creation Examples

This document shows the two task creation modes exposed by the client.

## Direct one-shot task

Use a direct one-shot when the task must run once immediately.

```bash
cd client
npm run create -- examples/task_weather.json
```

The client signs and executes the transaction with the local client key. The
Move entry is:

```move
oracle_tasks::create_and_submit_direct_task
```

Direct one-shot behavior:

- creates the task object;
- assigns registered oracle nodes immediately;
- opens and submits run `1` in the same transaction;
- charges the task payment and system fee;
- does not charge the scheduler fee;
- does not enter the scheduler queue.

Other direct examples:

```bash
npm run create -- examples/task_price_feed.json
npm run create -- examples/task_storage.json
```

## Scheduled task

Use a scheduled task when the task must run at least twice.

Scheduled tasks use:

```move
oracle_tasks::create_task
```

They are stored in the task registry and later processed by scheduler task `0`.
Each run consumes the task payment, system fee and template scheduler fee from
the task balance.

The client schedule command prepares the wallet/webview transaction. Use
future, minute-aligned timestamps for `startAt` and `endAt`:

```bash
cd client
npm run create -- prepare-task-schedule-webview examples/task_weather.json '{"startAt":"2030-01-01T12:00:00.000Z","endAt":"2030-01-01T12:05:00.000Z","interval_ms":300000,"initial_funds_iota":10}' 0xYOUR_WALLET_ADDRESS
```

You can also pass the schedule as a JSON file:

```json
{
  "startAt": "2030-01-01T12:00:00.000Z",
  "endAt": "2030-01-01T12:05:00.000Z",
  "interval_ms": 300000,
  "initial_funds_iota": 10
}
```

```bash
npm run create -- prepare-task-schedule-webview examples/task_weather.json examples/schedule_5m_two_runs.json 0xYOUR_WALLET_ADDRESS
```

The command returns JSON. The important fields are:

- `serializedTransaction`: transaction bytes for wallet signing;
- `executionMode`: `scheduled` or `direct`;
- `targetFunction`: `create_task` or `create_and_submit_direct_task`;
- `requiredPayment`: direct one-shot payment in nano-IOTA;
- `requiredPerRun`: scheduled per-run payment in nano-IOTA;
- `initialFunds`: amount locked in the scheduled task balance;
- `estimatedRuns`: estimated number of scheduled runs, or `null` for open-ended schedules.

For the result to be a scheduled task, `interval_ms` must be at least `300000`
and the time window must allow at least two runs. Otherwise the client prepares
a direct one-shot transaction.

## Choosing the mode

Use direct one-shot for ad-hoc requests, manual tests and any task that should
execute immediately once.

Use scheduled mode for recurring checks, repeated API polling, periodic
validation, or any task that needs lifecycle controls such as suspend, restart,
top-up and delete/refund.
