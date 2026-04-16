// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { NodeContext } from "../nodeContext";
import {
  advanceSchedulerQueueTx,
  completeSchedulerRoundTx,
  reconcileSchedulerQueueTx,
  startSchedulerRoundTx,
  submitScheduledTaskTx,
} from "../oracleSchedulerTx";
import { optInt } from "../nodeConfig";
import { listDueScheduledTasks, readSchedulerQueue } from "../services/schedulerReader";

function roundTimedOut(activeRoundStartedMs: number, nowMs: number): boolean {
  if (activeRoundStartedMs <= 0) return false;
  const timeoutMs = optInt("SCHEDULER_ROUND_TIMEOUT_MS", 60_000);
  return nowMs >= activeRoundStartedMs + timeoutMs;
}

export async function processSchedulerRound(ctx: NodeContext): Promise<void> {
  const nowMs = Date.now();
  await reconcileSchedulerQueueTx(ctx).catch((e: any) => {
    console.warn(`[scheduler ${ctx.nodeId}] reconcile failed: ${String(e?.message ?? e)}`);
  });

  let queue = await readSchedulerQueue(ctx.client);
  if (!queue.nodes.length) {
    console.warn(`[scheduler ${ctx.nodeId}] queue empty`);
    return;
  }

  if (queue.head !== ctx.myAddr) {
    if (!roundTimedOut(queue.activeRoundStartedMs, nowMs)) return;
    try {
      const digest = await advanceSchedulerQueueTx(ctx);
      console.log(`[scheduler ${ctx.nodeId}] advance queue tx=${digest}`);
    } catch (e: any) {
      console.warn(`[scheduler ${ctx.nodeId}] advance failed: ${String(e?.message ?? e)}`);
      return;
    }
    queue = await readSchedulerQueue(ctx.client);
    if (queue.head !== ctx.myAddr) return;
  }

  const startDigest = await startSchedulerRoundTx(ctx);
  console.log(`[scheduler ${ctx.nodeId}] start round tx=${startDigest}`);

  let processed = 0;
  try {
    const maxTasks = optInt("SCHEDULER_MAX_TASKS_PER_ROUND", 100);
    const dueTasks = (await listDueScheduledTasks(ctx.client, nowMs)).slice(0, maxTasks);
    for (const task of dueTasks) {
      try {
        const digest = await submitScheduledTaskTx(ctx, task.id);
        processed += 1;
        console.log(`[scheduler ${ctx.nodeId}] submitted scheduled task id=${task.id} tx=${digest}`);
      } catch (e: any) {
        console.warn(
          `[scheduler ${ctx.nodeId}] submit scheduled task failed id=${task.id}: ${String(e?.message ?? e)}`,
        );
      }
    }
  } finally {
    try {
      const digest = await completeSchedulerRoundTx(ctx, processed);
      console.log(`[scheduler ${ctx.nodeId}] complete round tx=${digest} processed=${processed}`);
    } catch (e: any) {
      console.warn(`[scheduler ${ctx.nodeId}] complete round failed: ${String(e?.message ?? e)}`);
    }
  }
}
