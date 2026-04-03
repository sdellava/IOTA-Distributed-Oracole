import { useEffect, useState } from "react";
import TaskValidator from "../components/TaskValidator";

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

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

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
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 12,
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <input
          type="text"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          placeholder="Enter task id"
          style={{
            width: "100%",
            height: 52,
            fontSize: 16,
            padding: "0 16px",
            borderRadius: 10,
          }}
        />
        <button
          onClick={handleValidate}
          disabled={loading}
          style={{
            height: 52,
            minWidth: 156,
            padding: "0 20px",
            borderRadius: 10,
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "Loading..." : "Validate"}
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <TaskValidator task={task} registeredNodes={registeredNodes} events={taskEvents} />
    </section>
  );
}
