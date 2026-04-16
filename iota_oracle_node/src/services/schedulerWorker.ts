// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { NodeContext } from "../nodeContext";
import { processSchedulerRound } from "../handlers/scheduler";
import { acceptsTemplate, optBool, optInt } from "../nodeConfig";
import { sleep } from "../utils/sleep";

function jitterMs(maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

export function startSchedulerWorker(ctx: NodeContext): void {
  if (!optBool("SCHEDULER_ENABLED", true)) return;
  if (!acceptsTemplate(0, ctx.acceptedTemplateIds)) return;

  const checkMs = optInt("SCHEDULER_CHECK_MS", 60_000);
  const startupJitter = jitterMs(optInt("SCHEDULER_STARTUP_JITTER_MS", 8_000));
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
    for (;;) {
      await loop();
      await sleep(checkMs);
    }
  })();
}
