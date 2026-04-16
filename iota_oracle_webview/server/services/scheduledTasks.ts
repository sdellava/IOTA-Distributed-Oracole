// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { IotaClient } from "@iota/iota-sdk/client";
import { getRuntimeConfig } from "../config.js";
import type { ScheduledTaskItem, ScheduledTasksResponse } from "../types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getMoveFields(obj: any): Record<string, any> {
  const c: any = obj?.data?.content;
  if (!c || c.dataType !== "moveObject") return {};
  return (c.fields ?? {}) as Record<string, any>;
}

function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "contents", "vec", "value"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function toText(value: any): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["value", "id", "objectId", "bytes", "balance"]) {
    const nested = record[key];
    if (typeof nested === "string" || typeof nested === "number" || typeof nested === "bigint") {
      return String(nested);
    }
  }
  return "";
}

function statusLabel(status: number): string {
  switch (status) {
    case 1:
      return "ACTIVE";
    case 2:
      return "FROZEN";
    case 9:
      return "CANCELLED";
    case 10:
      return "ENDED";
    default:
      return String(status || "-");
  }
}

function balanceToString(value: any): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value);
  const record = asRecord(value);
  if (!record) return "0";
  for (const key of ["value", "balance", "total"]) {
    if (record[key] != null) return balanceToString(record[key]);
  }
  return "0";
}

async function readScheduledTask(client: IotaClient, id: string): Promise<ScheduledTaskItem | null> {
  const obj = await client.getObject({ id, options: { showContent: true } } as any);
  const f = getMoveFields(obj);
  if (!Object.keys(f).length) return null;
  return {
    id,
    creator: toText(f.creator).toLowerCase(),
    status: Number(toText(f.status) || 0),
    statusLabel: statusLabel(Number(toText(f.status) || 0)),
    templateId: toText(f.template_id),
    nextRunMs: toText(f.next_run_ms),
    lastRunMs: toText(f.last_run_ms),
    startScheduleMs: toText(f.start_schedule_ms),
    endScheduleMs: toText(f.end_schedule_ms),
    intervalMs: toText(f.interval_ms),
    balanceIota: balanceToString(f.balance_iota),
    lastSchedulerNode: toText(f.last_scheduler_node).toLowerCase() || null,
  };
}

export async function getScheduledTasks(network?: string): Promise<ScheduledTasksResponse> {
  const runtime = getRuntimeConfig(network);
  const warnings: string[] = [];
  const registryId = runtime.oracleScheduledTaskRegistryId || null;
  const schedulerQueueId = runtime.oracleSchedulerQueueId || null;

  if (!registryId) warnings.push("Missing ORACLE_SCHEDULED_TASK_REGISTRY_ID for active network.");
  if (!schedulerQueueId) warnings.push("Missing ORACLE_SCHEDULER_QUEUE_ID for active network.");

  const client = new IotaClient({ url: runtime.rpcUrl });

  let queue: ScheduledTasksResponse["queue"] = null;
  if (schedulerQueueId) {
    try {
      const queueObj = await client.getObject({ id: schedulerQueueId, options: { showContent: true } } as any);
      const q = getMoveFields(queueObj);
      const nodes = toArray(q.nodes).map(toText).filter(Boolean).map((x) => x.toLowerCase());
      queue = {
        head: nodes[0] ?? null,
        nodes,
        activeRoundStartedMs: toText(q.active_round_started_ms),
        lastRoundCompletedMs: toText(q.last_round_completed_ms),
        roundCounter: toText(q.round_counter),
      };
    } catch (e: any) {
      warnings.push(`Failed to read scheduler queue: ${String(e?.message ?? e)}`);
    }
  }

  const items: ScheduledTaskItem[] = [];
  if (registryId) {
    try {
      const registryObj = await client.getObject({ id: registryId, options: { showContent: true } } as any);
      const fields = getMoveFields(registryObj);
      const ids = toArray(fields.scheduled_task_ids).map(toText).filter(Boolean);
      for (const id of ids) {
        try {
          const item = await readScheduledTask(client, id);
          if (item) items.push(item);
        } catch (e: any) {
          warnings.push(`Failed to read scheduled task ${id}: ${String(e?.message ?? e)}`);
        }
      }
    } catch (e: any) {
      warnings.push(`Failed to read scheduled task registry: ${String(e?.message ?? e)}`);
    }
  }

  items.sort((a, b) => Number(a.nextRunMs || "0") - Number(b.nextRunMs || "0") || a.id.localeCompare(b.id));

  return {
    ok: true,
    network: runtime.network,
    registryId,
    schedulerQueueId,
    queue,
    items,
    warnings,
  };
}
