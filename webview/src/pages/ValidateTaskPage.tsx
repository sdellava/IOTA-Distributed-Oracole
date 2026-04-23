// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useEffect, useRef, useState } from "react";
import TaskValidator from "../components/TaskValidator";
import { resolveApiBaseUrl } from "../lib/apiBase";
import type { OracleNetwork } from "../types";

type RegisteredNode = {
  nodeId?: string | number;
  id?: string | number;
  address?: string;
  pubkey?: unknown;
};

type TaskEvent = {
  id?: unknown;
  type?: string;
  sender?: string;
  timestampMs?: string | number | null;
  parsedJson?: Record<string, unknown> | null;
};

const API_BASE = resolveApiBaseUrl();

type Props = {
  initialTaskId?: string;
  activeNetwork: OracleNetwork;
};

type StreamStatus = "idle" | "connecting" | "live" | "reconnecting";

export default function ValidateTaskPage({ initialTaskId = "", activeNetwork }: Props) {
  const [taskId, setTaskId] = useState("");
  const [validatedTaskId, setValidatedTaskId] = useState("");
  const [task, setTask] = useState<any | null>(null);
  const [registeredNodes, setRegisteredNodes] = useState<RegisteredNode[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const lastAutoValidatedIdRef = useRef("");
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    void loadRegisteredNodes();
  }, [activeNetwork]);

  useEffect(() => {
    if (!initialTaskId) return;
    setTaskId(initialTaskId);
    if (lastAutoValidatedIdRef.current && lastAutoValidatedIdRef.current !== initialTaskId.trim().toLowerCase()) {
      lastAutoValidatedIdRef.current = "";
    }
  }, [initialTaskId]);

  async function loadRegisteredNodes() {
    try {
      const res = await fetch(`${API_BASE}/api/status?network=${encodeURIComponent(activeNetwork)}`);
      const data = await res.json();
      setRegisteredNodes(Array.isArray(data?.registeredNodes) ? data.registeredNodes : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchTaskSnapshot(normalizedTaskId: string, resetState = true): Promise<boolean> {
    try {
      if (resetState) {
        setLoading(true);
        setError("");
        setTask(null);
        setTaskEvents([]);
      }

      const taskRes = await fetch(
        `${API_BASE}/api/task/${encodeURIComponent(normalizedTaskId)}?network=${encodeURIComponent(activeNetwork)}`,
      );
      const taskContentType = taskRes.headers.get("content-type") || "";
      const taskText = await taskRes.text();

      if (!taskContentType.includes("application/json")) {
        throw new Error(`API did not return JSON. HTTP ${taskRes.status}`);
      }

      const taskData = JSON.parse(taskText);
      if (!taskRes.ok) {
        throw new Error(taskData?.error || `HTTP ${taskRes.status}`);
      }

      const eventsRes = await fetch(
        `${API_BASE}/api/task/${encodeURIComponent(normalizedTaskId)}/events?network=${encodeURIComponent(activeNetwork)}`,
      );
      const eventsContentType = eventsRes.headers.get("content-type") || "";
      const eventsText = await eventsRes.text();

      if (!eventsContentType.includes("application/json")) {
        throw new Error(`Events API did not return JSON. HTTP ${eventsRes.status}`);
      }

      const eventsData = JSON.parse(eventsText);
      if (!eventsRes.ok) {
        throw new Error(eventsData?.error || `HTTP ${eventsRes.status}`);
      }

      setTask(taskData);
      setTaskEvents(Array.isArray(eventsData?.events) ? eventsData.events : []);
      setValidatedTaskId(normalizedTaskId);
      setStreamStatus((current) => (current === "idle" ? "connecting" : current));
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setValidatedTaskId("");
      setStreamStatus("idle");
      return false;
    } finally {
      if (resetState) setLoading(false);
    }
  }

  async function handleValidate() {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      setError("Insert a task id.");
      setTask(null);
      setTaskEvents([]);
      setValidatedTaskId("");
      setStreamStatus("idle");
      return;
    }

    await fetchTaskSnapshot(normalizedTaskId, true);
  }

  useEffect(() => {
    if (!initialTaskId) return;
    const normalizedInitialTaskId = initialTaskId.trim().toLowerCase();
    if (!normalizedInitialTaskId) return;
    if (taskId.trim().toLowerCase() !== normalizedInitialTaskId) return;
    if (loading || lastAutoValidatedIdRef.current === normalizedInitialTaskId) return;
    lastAutoValidatedIdRef.current = normalizedInitialTaskId;
    void handleValidate();
  }, [initialTaskId, taskId, loading]);

  useEffect(() => {
    if (!validatedTaskId) {
      setStreamStatus("idle");
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      return;
    }

    const source = new EventSource(
      `${API_BASE}/api/task/${encodeURIComponent(validatedTaskId)}/stream?network=${encodeURIComponent(activeNetwork)}`,
    );
    streamRef.current = source;
    setStreamStatus("connecting");

    source.onopen = () => {
      setStreamStatus("live");
    };

    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data);
        setTask(payload?.task ?? null);
        setTaskEvents(Array.isArray(payload?.events) ? payload.events : []);
        setError("");
        setStreamStatus("live");
      } catch (streamError) {
        console.error(streamError);
      }
    });

    source.addEventListener("error", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data);
        if (payload?.error) setError(String(payload.error));
      } catch (streamError) {
        console.error(streamError);
      }
    });

    source.onerror = () => {
      setStreamStatus("reconnecting");
    };

    return () => {
      source.close();
      if (streamRef.current === source) {
        streamRef.current = null;
      }
    };
  }, [activeNetwork, validatedTaskId]);

  const liveStatusLabel =
    streamStatus === "live"
      ? "Live updates active"
      : streamStatus === "reconnecting"
        ? "Reconnecting to live updates..."
        : streamStatus === "connecting"
          ? "Connecting to live updates..."
          : validatedTaskId
            ? "Live updates paused"
            : "Waiting for a task id";

  return (
    <section className="card">
      <div className="section-title">Validate task</div>

      <div
        className="validate-input-row"
      >
        <input
          type="text"
          className="validate-task-input"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          placeholder="Enter task id"
        />
        <button
          className="validate-task-button"
          onClick={handleValidate}
          disabled={loading}
        >
          {loading ? "Loading..." : "Validate"}
        </button>
      </div>

      <div className={`validate-live-status validate-live-status-${streamStatus}`}>{liveStatusLabel}</div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <TaskValidator task={task} registeredNodes={registeredNodes} events={taskEvents} />
    </section>
  );
}
