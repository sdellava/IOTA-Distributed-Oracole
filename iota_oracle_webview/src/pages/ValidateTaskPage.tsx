import { useEffect, useState } from "react";
import TaskValidator from "../components/TaskValidator";
import { resolveApiBaseUrl } from "../lib/apiBase";

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

export default function ValidateTaskPage() {
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<any | null>(null);
  const [registeredNodes, setRegisteredNodes] = useState<RegisteredNode[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadRegisteredNodes();
  }, []);

  async function loadRegisteredNodes() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const data = await res.json();
      setRegisteredNodes(Array.isArray(data?.registeredNodes) ? data.registeredNodes : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleValidate() {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      setError("Insert a task id.");
      setTask(null);
      setTaskEvents([]);
      return;
    }

    setLoading(true);
    setError("");
    setTask(null);
    setTaskEvents([]);

    try {
      const taskRes = await fetch(`${API_BASE}/api/task/${encodeURIComponent(normalizedTaskId)}`);
      const taskContentType = taskRes.headers.get("content-type") || "";
      const taskText = await taskRes.text();

      if (!taskContentType.includes("application/json")) {
        throw new Error(`API did not return JSON. HTTP ${taskRes.status}`);
      }

      const taskData = JSON.parse(taskText);
      if (!taskRes.ok) {
        throw new Error(taskData?.error || `HTTP ${taskRes.status}`);
      }

      const eventsRes = await fetch(`${API_BASE}/api/task/${encodeURIComponent(normalizedTaskId)}/events`);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

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

      {error ? <div className="alert alert-error">{error}</div> : null}

      <TaskValidator task={task} registeredNodes={registeredNodes} events={taskEvents} />
    </section>
  );
}
