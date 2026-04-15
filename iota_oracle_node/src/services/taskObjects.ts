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

export function taskCreatedAtMs(bundle: Pick<TaskBundle, "runtimeFields">): number {
  return Number(bundle.runtimeFields?.created_at_ms ?? 0) || 0;
}

export function isTaskFreshForNode(bundle: Pick<TaskBundle, "runtimeFields">, startupMs: number): boolean {
  const createdAt = taskCreatedAtMs(bundle);
  const skewMs = 5_000;
  return createdAt <= 0 || createdAt + skewMs >= startupMs;
}

export async function loadTaskBundle(client: IotaClient, taskId: string): Promise<TaskBundle> {
  const taskObj = await client.getObject({ id: taskId, options: { showContent: true, showType: true } });
  const taskFields = getMoveFields(taskObj);

  const configId = extractObjectId(taskFields.config_id);
  const runtimeId = extractObjectId(taskFields.runtime_id);

  const [configObj, runtimeObj] = await Promise.all([
    configId ? client.getObject({ id: configId, options: { showContent: true, showType: true } }) : Promise.resolve(null as any),
    runtimeId ? client.getObject({ id: runtimeId, options: { showContent: true, showType: true } }) : Promise.resolve(null as any),
  ]);

  return {
    taskId,
    taskFields,
    configId,
    runtimeId,
    configFields: configObj ? getMoveFields(configObj) : {},
    runtimeFields: runtimeObj ? getMoveFields(runtimeObj) : {},
  };
}
