// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from "@iota/iota-sdk/client";

import { getMoveFields } from "../utils/move";

function extractObjectId(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (typeof x !== "object") return "";

  const direct = x.objectId ?? x.id ?? x.value ?? x.inner ?? x.bytes;
  if (typeof direct === "string") return direct;

  if (x.fields) {
    const nested = extractObjectId(x.fields);
    if (nested) return nested;
  }

  return "";
}

export type TaskBundle = {
  taskId: string;
  taskFields: Record<string, any>;
  configId: string;
  runtimeId: string;
  configFields: Record<string, any>;
  runtimeFields: Record<string, any>;
};

export function taskCreatedAtMs(bundle: Pick<TaskBundle, "taskFields" | "runtimeFields">): number {
  return Number(bundle.taskFields?.last_run_ms ?? bundle.runtimeFields?.created_at_ms ?? 0) || 0;
}

export function isTaskFreshForNode(bundle: Pick<TaskBundle, "taskFields" | "runtimeFields">, startupMs: number): boolean {
  const createdAt = taskCreatedAtMs(bundle);
  const skewMs = 5_000;
  return createdAt <= 0 || createdAt + skewMs >= startupMs;
}

export async function loadTaskBundle(client: IotaClient, taskId: string): Promise<TaskBundle> {
  const taskObj = await client.getObject({ id: taskId, options: { showContent: true, showType: true } });
  const taskFields = getMoveFields(taskObj);

  return {
    taskId,
    taskFields,
    configId: taskId,
    runtimeId: taskId,
    configFields: taskFields,
    runtimeFields: taskFields,
  };
}
