// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { TaskHandlerContext } from "./types";
import { getTaskHandler } from "./registry";
import { validateTemplatePolicy } from "./templatePolicy";

export async function runTask(taskType: string, payload: any, ctx: Omit<TaskHandlerContext, "taskType" | "payload"> = {}): Promise<string> {
  const normalizedTaskType = String(taskType ?? "").trim();
  validateTemplatePolicy(normalizedTaskType, payload, ctx.templateId);

  const h = getTaskHandler(normalizedTaskType);
  if (!h) throw new Error(`Unsupported task type: ${taskType}`);
  return h({ taskType, payload, ...ctx });
}
