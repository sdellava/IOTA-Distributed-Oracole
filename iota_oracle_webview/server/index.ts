import express from "express";
import cors from "cors";
import path from "node:path";
import { IotaClient } from "@iota/iota-sdk/client";
import { config, envDebug } from "./config.js";
import {
  executeOracleTask,
  listExampleTasks,
  prepareOracleTaskForWallet,
  readExampleTask,
} from "./services/oracleClient.js";
import { getOracleStatus } from "./services/oracleStatus.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function sendApiError(res: express.Response, status: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  res.status(status).json({ error: message });
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function normalizeAddress(value: unknown): string {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  return s.startsWith("0x") ? s : `0x${s}`;
}

function moveObjectIdToString(value: unknown): string {
  if (typeof value === "string") return value.trim();

  const record = asRecord(value);
  if (!record) return "";

  for (const key of ["id", "objectId", "value"]) {
    if (typeof record[key] === "string") return String(record[key]).trim();
  }

  return "";
}

async function queryTaskEventsByModule(
  client: IotaClient,
  packageId: string,
  moduleName: string,
  taskId: string,
) {
  if (!packageId || !moduleName) return [];

  const wantedTaskId = normalizeAddress(taskId);
  const out: Array<{
    id: unknown;
    type: string | null;
    sender: string | null;
    timestampMs: string | number | null;
    parsedJson: Record<string, unknown> | null;
    module: string;
  }> = [];

  let cursor: string | null | undefined = null;
  const pageLimit = Math.max(10, Number(config.eventFetchLimit || 100));

  for (let pageNo = 0; pageNo < 20; pageNo += 1) {
    const page: any = await client.queryEvents({
      query: {
        MoveModule: {
          package: packageId,
          module: moduleName,
        },
      },
      cursor,
      limit: pageLimit,
      order: "descending",
    } as any);

    for (const evt of page?.data ?? []) {
      const parsed = (evt?.parsedJson ?? evt?.parsed_json ?? null) as Record<string, unknown> | null;
      const eventTaskId = normalizeAddress(
        moveObjectIdToString(parsed?.task_id ?? parsed?.taskId),
      );

      if (eventTaskId !== wantedTaskId) continue;

      out.push({
        id: evt?.id ?? null,
        type: evt?.type ?? null,
        sender: evt?.sender ?? null,
        timestampMs: evt?.timestampMs ?? null,
        parsedJson: parsed,
        module: evt?.transactionModule ?? moduleName,
      });
    }

    if (!page?.hasNextPage || !page?.nextCursor) break;
    cursor = page.nextCursor;
  }

  return out;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "iota_oracle_webview", time: new Date().toISOString() });
});

app.get("/api/status", async (_req, res) => {
  try {
    const status = await getOracleStatus();
    res.json(status);
  } catch (error) {
    sendApiError(res, 500, error);
  }
});

app.get("/api/examples", async (_req, res) => {
  try {
    const items = await listExampleTasks();
    res.json(items);
  } catch (error) {
    sendApiError(res, 500, error);
  }
});

app.get("/api/examples/:name", async (req, res) => {
  try {
    const item = await readExampleTask(req.params.name);
    res.json(item);
  } catch (error) {
    sendApiError(res, 404, error);
  }
});

app.get("/api/task/:taskId", async (req, res) => {
  try {
    const taskId = String(req.params.taskId ?? "").trim();
    if (!taskId) {
      res.status(400).json({ error: "Missing taskId" });
      return;
    }

    const client = new IotaClient({ url: config.rpcUrl });

    const response = await client.getObject({
      id: taskId,
      options: {
        showType: true,
        showOwner: true,
        showContent: true,
        showDisplay: true,
      },
    });

    const data = response?.data as any;
    if (!data) {
      res.status(404).json({ error: `Task not found: ${taskId}` });
      return;
    }

    const content = data.content;
    const fields =
      content && typeof content === "object" && "fields" in content ? content.fields : {};

    function pick(...values: unknown[]) {
      for (const v of values) {
        if (v !== undefined && v !== null) return v;
      }
      return null;
    }

    function asArray(value: any): any[] {
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.items)) return value.items;
      if (value && Array.isArray(value.vec)) return value.vec;
      if (value && Array.isArray(value.fields?.items)) return value.fields.items;
      if (value && Array.isArray(value.fields?.contents)) return value.fields.contents;
      if (value && Array.isArray(value.contents)) return value.contents;
      return [];
    }

    const normalized = {
      objectId: data.objectId,
      version: data.version,
      digest: data.digest,
      type: data.type,
      owner: data.owner ?? null,
      task_id: data.objectId,
      template_id: pick(fields.template_id, fields.config?.fields?.template_id),
      state: pick(fields.state, fields.runtime?.fields?.state),
      quorum_k: Number(
        pick(fields.quorum_k, fields.config?.fields?.quorum_k, fields.consensus?.fields?.quorum_k, 0),
      ),
      multisig_addr: pick(fields.multisig_addr, fields.certificate?.fields?.multisig_addr),
      multisig_bytes: pick(fields.multisig_bytes, fields.certificate?.fields?.multisig_bytes),
      certificate_blob: pick(fields.certificate_blob, fields.certificate?.fields?.certificate_blob),
      certificate_signers: asArray(
        pick(fields.certificate_signers, fields.certificate?.fields?.certificate_signers),
      ),
      result: pick(fields.result, fields.runtime?.fields?.result),
      result_hash: pick(fields.result_hash, fields.runtime?.fields?.result_hash),
      result_bytes: pick(fields.result_bytes, fields.runtime?.fields?.result_bytes),
      raw: fields,
    };

    res.json(normalized);
  } catch (error) {
    sendApiError(res, 500, error);
  }
});

app.get("/api/task/:taskId/events", async (req, res) => {
  try {
    const taskId = String(req.params.taskId ?? "").trim();
    if (!taskId) {
      res.status(400).json({ error: "Missing taskId" });
      return;
    }

    const client = new IotaClient({ url: config.rpcUrl });

    const taskObj: any = await client.getObject({
      id: taskId,
      options: { showType: true },
    });

    const taskType = String(taskObj?.data?.type ?? "");
    const taskPackageId = taskType.split("::")[0] || config.oracleTasksPackageId;

    const [taskEvents, messageEvents] = await Promise.all([
      queryTaskEventsByModule(client, taskPackageId, config.oracleTaskModule, taskId),
      queryTaskEventsByModule(client, taskPackageId, config.oracleMessageModule, taskId).catch(() => []),
    ]);

    const events = [...taskEvents, ...messageEvents].sort(
      (a, b) => Number(a.timestampMs ?? 0) - Number(b.timestampMs ?? 0),
    );

    res.json({
      taskId,
      packageId: taskPackageId,
      events,
    });
  } catch (error) {
    sendApiError(res, 500, error);
  }
});

app.post("/api/tasks/prepare-wallet", async (req, res) => {
  try {
    if (typeof req.body !== "object" || req.body === null || !("task" in req.body)) {
      res.status(400).json({ error: 'Body must be { "task": ..., "sender": "0x..." }.' });
      return;
    }

    const sender = typeof req.body.sender === "string" ? req.body.sender.trim() : "";
    if (!sender) {
      res.status(400).json({ error: "Body must include sender as a wallet address." });
      return;
    }

    const result = await prepareOracleTaskForWallet((req.body as any).task, sender);
    res.json(result);
  } catch (error) {
    sendApiError(res, 500, error);
  }
});

app.post("/api/tasks/execute", async (req, res) => {
  try {
    if (typeof req.body !== "object" || req.body === null || !("task" in req.body)) {
      res.status(400).json({ error: 'Body must be { "task": ... }.' });
      return;
    }

    const result = await executeOracleTask((req.body as any).task);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    sendApiError(res, 500, error);
  }
});

const distPath = path.resolve(process.cwd(), "dist");
app.use(express.static(distPath));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: `API route not found: ${req.path}` });
    return;
  }
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`[iota_oracle_webview] listening on http://0.0.0.0:${config.port}`);
  console.log(`[iota_oracle_webview] client dir: ${config.oracleClientDir}`);
  console.log(`[iota_oracle_webview] examples dir: ${config.oracleExamplesDir}`);
  console.log(`[iota_oracle_webview] env cwd: ${envDebug.cwd}`);
  console.log(
    `[iota_oracle_webview] ORACLE_TASKS_PACKAGE_ID loaded: ${config.oracleTasksPackageId ? "yes" : "no"}`,
  );
  console.log(
    `[iota_oracle_webview] ORACLE_SYSTEM_PACKAGE_ID loaded: ${config.oracleSystemPackageId ? "yes" : "no"}`,
  );
  console.log(
    `[iota_oracle_webview] ORACLE_STATE_ID loaded: ${config.oracleStateId ? "yes" : "no"}`,
  );
});
