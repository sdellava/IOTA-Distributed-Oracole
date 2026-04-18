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
import { listDueTasks, readRegisteredOracleNodes, readTaskSchedulerQueue } from "../services/schedulerReader";

function schedulerLeaseMs(): number {
  return optInt("SCHEDULER_ROUND_TIMEOUT_MS", 30_000);
}

function queueIndexOf(nodeIds: number[], nodeId: number): number {
  return nodeIds.findIndex((item) => item === nodeId);
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
  const registeredNodes = await readRegisteredOracleNodes(ctx.client);
  const myNode = registeredNodes.find((node) => node.addr === ctx.myAddr);
  if (!myNode) return;

  let queue = await readTaskSchedulerQueue(ctx.client);
  if (!queue.nodeIds.length) {
    const lowestNodeId = registeredNodes
      .map((node) => node.nodeId)
      .sort((a, b) => a - b)[0];
    if (myNode.nodeId !== lowestNodeId) return;
    try {
      const digest = await reconcileSchedulerQueueTx(ctx);
      console.log(`[scheduler ${ctx.nodeId}] reconcile queue tx=${digest}`);
    } catch (e: any) {
      console.warn(`[scheduler ${ctx.nodeId}] reconcile queue failed: ${String(e?.message ?? e)}`);
      return;
    }
    queue = await readTaskSchedulerQueue(ctx.client);
  }

  if (!queue.nodeIds.length && !registeredNodes.length) {
    console.warn(`[scheduler ${ctx.nodeId}] queue empty`);
    return;
  }

  const refreshedIndex = queueIndexOf(queue.nodeIds, myNode.nodeId);
  if (refreshedIndex < 0) return;

  if (queue.headNodeId !== myNode.nodeId) {
    if (!takeoverEligible(queue.activeRoundStartedMs, queue.lastRoundCompletedMs, refreshedIndex, nowMs)) return;
    try {
      const digest = await advanceSchedulerQueueTx(ctx);
      console.log(`[scheduler ${ctx.nodeId}] advance queue tx=${digest}`);
    } catch (e: any) {
      console.warn(`[scheduler ${ctx.nodeId}] advance failed: ${String(e?.message ?? e)}`);
      return;
    }
    queue = await readTaskSchedulerQueue(ctx.client);
    if (queue.headNodeId !== myNode.nodeId) return;
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
