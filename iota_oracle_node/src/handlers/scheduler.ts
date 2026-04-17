// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { NodeContext } from "../nodeContext";
import {
  advanceSchedulerQueueTx,
  completeSchedulerRoundTx,
  reconcileSchedulerQueueTx,
  startSchedulerRoundTx,
  submitTaskRunTx,
} from "../oracleSchedulerTx";
import { optInt } from "../nodeConfig";
import { listDueTasks, readTaskSchedulerQueue } from "../services/schedulerReader";

function schedulerLeaseMs(): number {
  return optInt("SCHEDULER_ROUND_TIMEOUT_MS", 30_000);
}

function queueIndexOf(nodes: string[], addr: string): number {
  return nodes.findIndex((node) => node === addr);
}

function takeoverEligible(
  activeRoundStartedMs: number,
  lastRoundCompletedMs: number,
  queueIndex: number,
  nowMs: number,
): boolean {
  if (queueIndex <= 0) return false;
  const baseMs = activeRoundStartedMs > 0 ? activeRoundStartedMs : lastRoundCompletedMs;
  if (baseMs <= 0) return false;
  return nowMs >= baseMs + queueIndex * schedulerLeaseMs();
}

export async function processSchedulerRound(ctx: NodeContext): Promise<void> {
  const nowMs = Date.now();
  let queue = await readTaskSchedulerQueue(ctx.client);
  if (!queue.nodes.length) {
    await reconcileSchedulerQueueTx(ctx).catch((e: any) => {
      console.warn(`[scheduler ${ctx.nodeId}] reconcile failed: ${String(e?.message ?? e)}`);
    });
    queue = await readTaskSchedulerQueue(ctx.client);
  }

  if (!queue.nodes.length) {
    console.warn(`[scheduler ${ctx.nodeId}] queue empty`);
    return;
  }

  const myIndex = queueIndexOf(queue.nodes, ctx.myAddr);
  if (myIndex < 0) {
    await reconcileSchedulerQueueTx(ctx).catch((e: any) => {
      console.warn(`[scheduler ${ctx.nodeId}] reconcile failed: ${String(e?.message ?? e)}`);
    });
    queue = await readTaskSchedulerQueue(ctx.client);
  }

  const refreshedIndex = queueIndexOf(queue.nodes, ctx.myAddr);
  if (refreshedIndex < 0) return;

  if (queue.head !== ctx.myAddr) {
    if (!takeoverEligible(queue.activeRoundStartedMs, queue.lastRoundCompletedMs, refreshedIndex, nowMs)) return;
    try {
      const digest = await advanceSchedulerQueueTx(ctx);
      console.log(`[scheduler ${ctx.nodeId}] advance queue tx=${digest}`);
    } catch (e: any) {
      console.warn(`[scheduler ${ctx.nodeId}] advance failed: ${String(e?.message ?? e)}`);
      return;
    }
    queue = await readTaskSchedulerQueue(ctx.client);
    if (queue.head !== ctx.myAddr) return;
  }

  const startDigest = await startSchedulerRoundTx(ctx);
  console.log(`[scheduler ${ctx.nodeId}] start round tx=${startDigest}`);

  let processed = 0;
  try {
    const maxTasks = optInt("SCHEDULER_MAX_TASKS_PER_ROUND", 100);
    const dueTasks = (await listDueTasks(ctx.client, nowMs)).slice(0, maxTasks);
    for (const task of dueTasks) {
      try {
        const digest = await submitTaskRunTx(ctx, task.id);
        processed += 1;
        console.log(`[scheduler ${ctx.nodeId}] submitted task run id=${task.id} tx=${digest}`);
      } catch (e: any) {
        console.warn(
          `[scheduler ${ctx.nodeId}] submit task run failed id=${task.id}: ${String(e?.message ?? e)}`,
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
