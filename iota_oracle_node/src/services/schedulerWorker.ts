// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { NodeContext } from "../nodeContext";
import { processSchedulerRound } from "../handlers/scheduler";
import { optBool, optInt } from "../nodeConfig";
import { sleep } from "../utils/sleep";

const DEFAULT_SCHEDULER_TICK_SECOND = 2;
const ONE_MINUTE_MS = 60_000;

function jitterMs(maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

function normalizeSecond(second: number): number {
  if (!Number.isFinite(second)) return DEFAULT_SCHEDULER_TICK_SECOND;
  return Math.min(59, Math.max(0, Math.floor(second)));
}

function nextSchedulerTickDelayMs(tickSecond: number, nowMs = Date.now()): number {
  const tickOffsetMs = normalizeSecond(tickSecond) * 1000;
  const currentMinuteStartMs = Math.floor(nowMs / ONE_MINUTE_MS) * ONE_MINUTE_MS;
  let nextTickMs = currentMinuteStartMs + tickOffsetMs;
  if (nextTickMs <= nowMs) nextTickMs += ONE_MINUTE_MS;
  return nextTickMs - nowMs;
}

export function startSchedulerWorker(ctx: NodeContext): void {
  if (!optBool("SCHEDULER_ENABLED", true)) return;

  const startupJitter = jitterMs(optInt("SCHEDULER_STARTUP_JITTER_MS", 0));
  const tickSecond = normalizeSecond(optInt("SCHEDULER_TICK_SECOND", DEFAULT_SCHEDULER_TICK_SECOND));
  let inFlight = false;

  const loop = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await processSchedulerRound(ctx);
    } catch (e: any) {
      console.warn(`[scheduler ${ctx.nodeId}] worker tick failed: ${String(e?.message ?? e)}`);
    } finally {
      inFlight = false;
    }
  };

  void (async () => {
    if (startupJitter > 0) await sleep(startupJitter);
    console.log(`[scheduler ${ctx.nodeId}] worker aligned to second=${tickSecond.toString().padStart(2, "0")} every minute`);
    for (;;) {
      await sleep(nextSchedulerTickDelayMs(tickSecond));
      await loop();
    }
  })();
}
