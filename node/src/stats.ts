// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from "@iota/iota-sdk/client";

type TaskOutcome = "ok" | "not_ok";

type TaskRecord = {
  ts: number;
  outcome: TaskOutcome;
  taskId: string;
  round: number;
  taskType: string;
  error: string | null;
};

type BalanceSnapshot = {
  fetchedAtMs: number;
  totalBalance: string;
  coinObjectCount: number;
  lockedBalance?: string;
};

export class NodeStats {
  private readonly completed: TaskRecord[] = [];
  private balanceCache: BalanceSnapshot | null = null;
  private balanceError: string | null = null;
  private balanceFetchInFlight: Promise<BalanceSnapshot | null> | null = null;

  recordTaskCompleted(input: {
    outcome: TaskOutcome;
    taskId: string;
    round: number;
    taskType: string;
    error?: string | null;
    ts?: number;
  }): void {
    this.completed.push({
      ts: input.ts ?? Date.now(),
      outcome: input.outcome,
      taskId: input.taskId,
      round: input.round,
      taskType: input.taskType,
      error: input.error ?? null,
    });
    this.pruneOldRecords();
  }

  getTaskStats(now = Date.now()): {
    total: number;
    ok: number;
    notOk: number;
    last24h: {
      total: number;
      ok: number;
      notOk: number;
    };
    lastCompletedAtMs: number | null;
    lastError: string | null;
  } {
    this.pruneOldRecords(now);

    let ok = 0;
    let notOk = 0;
    let last24hOk = 0;
    let last24hNotOk = 0;
    let lastCompletedAtMs: number | null = null;
    let lastError: string | null = null;
    const cutoff = now - 24 * 60 * 60 * 1000;

    for (const item of this.completed) {
      if (item.outcome === "ok") ok += 1;
      else notOk += 1;

      if (item.ts >= cutoff) {
        if (item.outcome === "ok") last24hOk += 1;
        else last24hNotOk += 1;
      }

      if (lastCompletedAtMs == null || item.ts > lastCompletedAtMs) {
        lastCompletedAtMs = item.ts;
      }
    }

    for (let i = this.completed.length - 1; i >= 0; i -= 1) {
      const item = this.completed[i];
      if (item.error) {
        lastError = item.error;
        break;
      }
    }

    return {
      total: this.completed.length,
      ok,
      notOk,
      last24h: {
        total: last24hOk + last24hNotOk,
        ok: last24hOk,
        notOk: last24hNotOk,
      },
      lastCompletedAtMs,
      lastError,
    };
  }

  async getBalanceSnapshot(client: IotaClient, owner: string): Promise<{
    data: BalanceSnapshot | null;
    error: string | null;
  }> {
    const now = Date.now();
    if (this.balanceCache && now - this.balanceCache.fetchedAtMs < 30_000) {
      return { data: this.balanceCache, error: this.balanceError };
    }

    if (this.balanceFetchInFlight) {
      const data = await this.balanceFetchInFlight;
      return { data, error: this.balanceError };
    }

    this.balanceFetchInFlight = (async () => {
      try {
        const res: any = await client.getBalance({ owner } as any);
        const snapshot: BalanceSnapshot = {
          fetchedAtMs: Date.now(),
          totalBalance: String(res?.totalBalance ?? "0"),
          coinObjectCount: Number(res?.coinObjectCount ?? 0) || 0,
          lockedBalance: res?.lockedBalance != null ? String(res.lockedBalance) : undefined,
        };
        this.balanceCache = snapshot;
        this.balanceError = null;
        return snapshot;
      } catch (e: any) {
        this.balanceError = String(e?.message ?? e);
        return this.balanceCache;
      } finally {
        this.balanceFetchInFlight = null;
      }
    })();

    const data = await this.balanceFetchInFlight;
    return { data, error: this.balanceError };
  }

  private pruneOldRecords(now = Date.now()): void {
    const retentionMs = 7 * 24 * 60 * 60 * 1000;
    while (this.completed.length > 0 && this.completed[0].ts < now - retentionMs) {
      this.completed.shift();
    }
  }
}
