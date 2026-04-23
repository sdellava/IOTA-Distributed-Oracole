// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from "@iota/iota-sdk/client";

import { getMoveFields } from "../utils/move";
import { sleep } from "../utils/sleep";

export async function waitForTaskState(opts: {
  client: IotaClient;
  taskId: string;
  desiredState: number;
  timeoutMs: number;
  pollMs: number;
}): Promise<{ ok: true; state: number } | { ok: false; state: number }> {
  const { client, taskId, desiredState, timeoutMs, pollMs } = opts;
  const started = Date.now();

  let lastState = -1;
  while (Date.now() - started < timeoutMs) {
    const obj = await client.getObject({ id: taskId, options: { showContent: true } });
    const f = getMoveFields(obj);
    const s = Number(f.state ?? -1);
    lastState = s;
    if (s === desiredState) return { ok: true, state: s };
    await sleep(pollMs);
  }
  return { ok: false, state: lastState };
}

export async function readTaskStateAndRound(
  client: IotaClient,
  taskId: string,
): Promise<{ state: number; round: number }> {
  const obj = await client.getObject({ id: taskId, options: { showContent: true } });
  const f = getMoveFields(obj);
  return {
    state: Number(f.state ?? -1),
    round: Number(f.active_round ?? 0) || 0,
  };
}
