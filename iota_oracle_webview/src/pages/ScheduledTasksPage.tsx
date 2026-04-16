// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useEffect, useState } from "react";
import { fetchScheduledTasks } from "../lib/api";
import type { ScheduledTaskItem, ScheduledTasksResponse } from "../types";

function shortAddress(address: string | null | undefined, start = 6, end = 4): string {
  const value = String(address ?? "").trim();
  if (!value) return "-";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function formatMs(value: string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n).toLocaleString();
}

function formatIntervalMs(value: string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const seconds = Math.floor(n / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatIotaAtomic(value: string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return value ? String(value) : "-";
  return (n / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function statusClass(item: ScheduledTaskItem): string {
  const label = item.statusLabel.toLowerCase();
  if (label === "active") return "is-on";
  if (label === "ended") return "is-off";
  return "is-warn";
}

export default function ScheduledTasksPage() {
  const [data, setData] = useState<ScheduledTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchScheduledTasks();
        if (!cancelled) {
          setData(response);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {data?.warnings?.length ? (
        <div className="alert alert-warn">
          {data.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <section className="card card-spaced">
        <div className="section-title">Scheduler queue</div>
        {loading ? (
          <div className="empty">Loading scheduler queue...</div>
        ) : !data?.queue ? (
          <div className="empty">Scheduler queue not available.</div>
        ) : (
          <div className="template-details-grid">
            <div className="template-kv-item">
              <span className="template-kv-label">Head</span>
              <span className="template-kv-value mono">{shortAddress(data.queue.head)}</span>
            </div>
            <div className="template-kv-item">
              <span className="template-kv-label">Round counter</span>
              <span className="template-kv-value mono">{data.queue.roundCounter || "-"}</span>
            </div>
            <div className="template-kv-item">
              <span className="template-kv-label">Active round started</span>
              <span className="template-kv-value">{formatMs(data.queue.activeRoundStartedMs)}</span>
            </div>
            <div className="template-kv-item">
              <span className="template-kv-label">Last round completed</span>
              <span className="template-kv-value">{formatMs(data.queue.lastRoundCompletedMs)}</span>
            </div>
            <div className="template-kv-item scheduled-queue-item">
              <span className="template-kv-label">Queue nodes</span>
              <span className="template-kv-value">
                {data.queue.nodes.length ? data.queue.nodes.map((item) => shortAddress(item)).join(" -> ") : "-"}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="card card-spaced">
        <div className="section-title">Scheduled tasks</div>
        {loading ? (
          <div className="empty">Loading scheduled tasks...</div>
        ) : !data?.items?.length ? (
          <div className="empty">No scheduled tasks found.</div>
        ) : (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Template</th>
                  <th>Next run</th>
                  <th>Interval</th>
                  <th>Balance</th>
                  <th>Creator</th>
                  <th>Last scheduler</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Task">
                      <div className="mono">{shortAddress(item.id, 8, 6)}</div>
                      <div className="summary-hint">Start {formatMs(item.startScheduleMs)}</div>
                    </td>
                    <td data-label="Status">
                      <span className={`template-status-badge ${statusClass(item)}`}>{item.statusLabel}</span>
                    </td>
                    <td data-label="Template" className="mono">
                      {item.templateId || "-"}
                    </td>
                    <td data-label="Next run">
                      <div>{formatMs(item.nextRunMs)}</div>
                      <div className="summary-hint">Last {formatMs(item.lastRunMs)}</div>
                    </td>
                    <td data-label="Interval">{formatIntervalMs(item.intervalMs)}</td>
                    <td data-label="Balance">
                      <div className="mono">{item.balanceIota || "0"}</div>
                      <div className="summary-hint">{formatIotaAtomic(item.balanceIota)} IOTA</div>
                    </td>
                    <td data-label="Creator" className="mono">
                      {shortAddress(item.creator)}
                    </td>
                    <td data-label="Last scheduler" className="mono">
                      {shortAddress(item.lastSchedulerNode)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
