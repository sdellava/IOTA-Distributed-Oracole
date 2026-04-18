// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary
import express from "express";
import cors from "cors";
import path from "node:path";
import { IotaClient } from "@iota/iota-sdk/client";
import { config, envDebug, getActiveNetwork, getRuntimeConfig, getSupportedNetworks, setActiveNetwork, } from "./config.js";
import { executeOracleTask, listExampleTasks, prepareOracleTaskScheduleForWallet, prepareOracleTaskForWallet, readExampleTask, } from "./services/oracleClient.js";
import { getIotaMarketPrice } from "./services/marketData.js";
import { getOracleStatus } from "./services/oracleStatus.js";
import { getTaskSchedules } from "./services/taskSchedules.js";
const app = express();
app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self';");
    next();
});
app.use(cors());
app.use(express.json({ limit: "2mb" }));
function sendApiError(res, status, error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(status).json({ error: message });
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function extractFields(value) {
    const record = asRecord(value);
    if (!record)
        return null;
    const fields = asRecord(record.fields);
    if (fields)
        return fields;
    const data = asRecord(record.data);
    if (data) {
        const nested = extractFields(data);
        if (nested)
            return nested;
    }
    const content = asRecord(record.content);
    if (content) {
        const nested = extractFields(content);
        if (nested)
            return nested;
    }
    const nestedValue = asRecord(record.value);
    if (nestedValue) {
        const nested = extractFields(nestedValue);
        if (nested)
            return nested;
    }
    return null;
}
function normalizeAddress(value) {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s)
        return "";
    return s.startsWith("0x") ? s : `0x${s}`;
}
function moveObjectIdToString(value) {
    if (typeof value === "string")
        return value.trim();
    const record = asRecord(value);
    if (!record)
        return "";
    for (const key of ["id", "objectId", "value"]) {
        if (typeof record[key] === "string")
            return String(record[key]).trim();
    }
    return "";
}
function extractEventTaskId(value) {
    const direct = normalizeAddress(moveObjectIdToString(asRecord(value)?.task_id ??
        asRecord(value)?.taskId ??
        asRecord(value)?.task ??
        asRecord(asRecord(value)?.task)?.id));
    if (direct)
        return direct;
    const record = extractFields(value) ?? asRecord(value);
    if (!record)
        return "";
    for (const key of ["task_id", "taskId", "task"]) {
        if (!(key in record))
            continue;
        const nested = normalizeAddress(moveObjectIdToString(record[key]));
        if (nested)
            return nested;
        const nestedFields = extractFields(record[key]) ?? asRecord(record[key]);
        if (!nestedFields)
            continue;
        const nestedId = normalizeAddress(moveObjectIdToString(nestedFields.id ?? nestedFields.objectId ?? nestedFields.value));
        if (nestedId)
            return nestedId;
    }
    return "";
}
function numberFromUnknown(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return Math.floor(value);
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return Math.floor(parsed);
    }
    const record = asRecord(value);
    if (!record)
        return null;
    return numberFromUnknown(record.value);
}
function taskCompatState(fields) {
    const directState = numberFromUnknown(fields.state);
    if (directState != null)
        return directState;
    const executionState = numberFromUnknown(fields.execution_state) ?? -1;
    if (executionState === 1)
        return 1;
    if (executionState === 2)
        return 2;
    if (executionState === 9)
        return 9;
    if (executionState === 10)
        return 10;
    return 0;
}
function unwrapFieldValue(obj) {
    const nestedValue = asRecord(obj?.data?.content?.fields?.value?.fields);
    if (nestedValue)
        return nestedValue;
    const value = asRecord(obj?.data?.content?.fields?.value);
    if (value)
        return value;
    const direct = asRecord(obj?.data?.content?.fields);
    if (direct)
        return direct;
    const content = asRecord(obj?.data?.content);
    if (content) {
        const nested = asRecord(content.fields);
        if (nested)
            return nested;
    }
    return {};
}
async function fetchLatestTaskResult(client, taskId, tasksPackageId) {
    if (!taskId || !tasksPackageId)
        return {};
    try {
        const page = await client.getDynamicFields({
            parentId: taskId,
            limit: 50,
        });
        const candidates = (page?.data ?? []).filter((item) => {
            const objectType = String(item?.objectType ?? "");
            const nameType = String(item?.name?.type ?? "");
            return (objectType === `${tasksPackageId}::oracle_tasks::TaskResult` ||
                nameType === `${tasksPackageId}::oracle_tasks::TaskResultKey`);
        });
        if (!candidates.length)
            return {};
        const objects = await Promise.all(candidates.map(async (item) => {
            const objectId = String(item?.objectId ?? "").trim();
            if (!objectId)
                return null;
            try {
                const obj = await client.getObject({
                    id: objectId,
                    options: { showContent: true, showType: true },
                });
                const fields = unwrapFieldValue(obj);
                return {
                    objectId,
                    seq: numberFromUnknown(item?.name?.value?.seq) ?? -1,
                    producedAtMs: numberFromUnknown(fields.produced_at_ms) ?? -1,
                    runIndex: numberFromUnknown(fields.run_index) ?? -1,
                    fields,
                };
            }
            catch {
                return null;
            }
        }));
        const latest = objects
            .filter((item) => Boolean(item))
            .sort((a, b) => {
            if (b.producedAtMs !== a.producedAtMs)
                return b.producedAtMs - a.producedAtMs;
            if (b.seq !== a.seq)
                return b.seq - a.seq;
            return b.runIndex - a.runIndex;
        })[0];
        return latest?.fields ?? {};
    }
    catch {
        return {};
    }
}
async function queryTaskEventsByModule(client, packageId, moduleName, taskId) {
    if (!packageId || !moduleName)
        return [];
    const wantedTaskId = normalizeAddress(taskId);
    const out = [];
    let cursor = null;
    const pageLimit = Math.max(10, Number(config.eventFetchLimit || 100));
    for (let pageNo = 0; pageNo < 20; pageNo += 1) {
        const page = await client.queryEvents({
            query: {
                MoveModule: {
                    package: packageId,
                    module: moduleName,
                },
            },
            cursor,
            limit: pageLimit,
            order: "descending",
        });
        for (const evt of page?.data ?? []) {
            const parsed = (evt?.parsedJson ?? evt?.parsed_json ?? null);
            const eventTaskId = extractEventTaskId(parsed);
            if (eventTaskId !== wantedTaskId)
                continue;
            out.push({
                id: evt?.id ?? null,
                type: evt?.type ?? null,
                sender: evt?.sender ?? null,
                timestampMs: evt?.timestampMs ?? null,
                parsedJson: parsed,
                module: evt?.transactionModule ?? moduleName,
            });
        }
        if (!page?.hasNextPage || !page?.nextCursor)
            break;
        cursor = page.nextCursor;
    }
    return out;
}
app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "iota_oracle_webview", time: new Date().toISOString() });
});
app.get("/api/status", async (req, res) => {
    try {
        const network = typeof req.query.network === "string" ? req.query.network : undefined;
        const status = await getOracleStatus(network);
        res.json(status);
    }
    catch (error) {
        sendApiError(res, 500, error);
    }
});
app.get("/api/task-schedules", async (req, res) => {
    try {
        const network = typeof req.query.network === "string" ? req.query.network : undefined;
        const data = await getTaskSchedules(network);
        res.json(data);
    }
    catch (error) {
        sendApiError(res, 500, error);
    }
});
app.get("/api/network", (req, res) => {
    const requested = typeof req.query.network === "string" ? req.query.network : undefined;
    const runtime = getRuntimeConfig(requested);
    res.json({
        activeNetwork: requested ? runtime.network : getActiveNetwork(),
        supportedNetworks: getSupportedNetworks(),
        rpcUrl: runtime.rpcUrl,
        tasksPackageId: runtime.oracleTasksPackageId || null,
        systemPackageId: runtime.oracleSystemPackageId || null,
        stateId: runtime.oracleStateId || null,
    });
});
app.post("/api/network", (req, res) => {
    try {
        const network = String(req.body?.network ?? "").trim();
        if (!network) {
            res.status(400).json({ error: "Body must include network." });
            return;
        }
        const activeNetwork = setActiveNetwork(network);
        const runtime = getRuntimeConfig(activeNetwork);
        res.json({
            ok: true,
            activeNetwork,
            supportedNetworks: getSupportedNetworks(),
            rpcUrl: runtime.rpcUrl,
            tasksPackageId: runtime.oracleTasksPackageId || null,
            systemPackageId: runtime.oracleSystemPackageId || null,
            stateId: runtime.oracleStateId || null,
        });
    }
    catch (error) {
        sendApiError(res, 400, error);
    }
});
app.get("/api/examples", async (_req, res) => {
    try {
        const items = await listExampleTasks();
        res.json(items);
    }
    catch (error) {
        sendApiError(res, 500, error);
    }
});
app.get("/api/examples/:name", async (req, res) => {
    try {
        const item = await readExampleTask(req.params.name);
        res.json(item);
    }
    catch (error) {
        sendApiError(res, 404, error);
    }
});
app.get("/api/market/iota-price", async (_req, res) => {
    try {
        const price = await getIotaMarketPrice();
        res.json(price);
    }
    catch (error) {
        sendApiError(res, 502, error);
    }
});
app.get("/api/task/:taskId", async (req, res) => {
    try {
        const taskId = String(req.params.taskId ?? "").trim();
        if (!taskId) {
            res.status(400).json({ error: "Missing taskId" });
            return;
        }
        const runtime = getRuntimeConfig();
        const client = new IotaClient({ url: runtime.rpcUrl });
        const response = await client.getObject({
            id: taskId,
            options: {
                showType: true,
                showOwner: true,
                showContent: true,
                showDisplay: true,
            },
        });
        const data = response?.data;
        if (!data) {
            res.status(404).json({ error: `Task not found: ${taskId}` });
            return;
        }
        const fields = extractFields(data.content) ?? {};
        const latestResultSeq = numberFromUnknown(fields.latest_result_seq) ?? 0;
        const latestResultFields = latestResultSeq > 0 && runtime.oracleTasksPackageId
            ? await fetchLatestTaskResult(client, taskId, runtime.oracleTasksPackageId)
            : {};
        function pick(...values) {
            for (const v of values) {
                if (v !== undefined && v !== null)
                    return v;
            }
            return null;
        }
        function collectArrayItems(value, out) {
            if (value == null)
                return;
            if (Array.isArray(value)) {
                for (const item of value)
                    collectArrayItems(item, out);
                return;
            }
            if (typeof value !== "object") {
                out.push(value);
                return;
            }
            const record = value;
            const nestedFields = asRecord(record.fields);
            if (nestedFields && nestedFields !== record)
                collectArrayItems(nestedFields, out);
            for (const key of ["items", "contents", "vec", "value", "fields", "data"]) {
                if (key in record)
                    collectArrayItems(record[key], out);
            }
        }
        function asArray(value) {
            const out = [];
            collectArrayItems(value, out);
            return out;
        }
        function asTextArray(value) {
            const out = [];
            for (const item of asArray(value)) {
                const normalized = normalizeAddress(moveObjectIdToString(item) || String(item ?? ""));
                if (normalized)
                    out.push(normalized);
            }
            return out.filter((item, index) => out.indexOf(item) === index);
        }
        const normalized = {
            objectId: data.objectId,
            version: data.version,
            digest: data.digest,
            type: data.type,
            owner: data.owner ?? null,
            task_id: data.objectId,
            template_id: pick(fields.template_id, fields.config?.fields?.template_id),
            assigned_nodes: asTextArray(pick(fields.assigned_nodes, fields.runtime?.fields?.assigned_nodes, fields.consensus?.fields?.assigned_nodes)),
            status: pick(fields.status, fields.runtime?.fields?.status),
            execution_state: pick(fields.execution_state, fields.runtime?.fields?.execution_state),
            active_round: pick(fields.active_round, fields.runtime?.fields?.active_round),
            state: taskCompatState(fields),
            quorum_k: Number(pick(fields.quorum_k, fields.config?.fields?.quorum_k, fields.consensus?.fields?.quorum_k, 0)),
            multisig_addr: pick(latestResultFields.multisig_addr, fields.multisig_addr, fields.certificate?.fields?.multisig_addr),
            multisig_bytes: pick(latestResultFields.multisig_bytes, fields.multisig_bytes, fields.certificate?.fields?.multisig_bytes),
            certificate_blob: pick(latestResultFields.certificate_blob, fields.certificate_blob, fields.certificate?.fields?.certificate_blob),
            certificate_signers: asTextArray(pick(latestResultFields.certificate_signers, fields.certificate_signers, fields.certificate?.fields?.certificate_signers)),
            result: pick(latestResultFields.result, fields.result, fields.runtime?.fields?.result),
            result_hash: pick(latestResultFields.result_hash, fields.result_hash, fields.runtime?.fields?.result_hash),
            result_bytes: pick(latestResultFields.result, latestResultFields.result_bytes, fields.result_bytes, fields.runtime?.fields?.result_bytes),
            reason_code: pick(latestResultFields.reason_code, 0),
            latest_result_seq: pick(fields.latest_result_seq, fields.runtime?.fields?.latest_result_seq),
            result_order: asArray(pick(fields.result_order, fields.runtime?.fields?.result_order)),
            latest_result: latestResultFields,
            raw: fields,
        };
        res.json(normalized);
    }
    catch (error) {
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
        const runtime = getRuntimeConfig();
        const client = new IotaClient({ url: runtime.rpcUrl });
        const taskObj = await client.getObject({
            id: taskId,
            options: { showType: true },
        });
        const taskType = String(taskObj?.data?.type ?? "");
        const taskPackageId = taskType.split("::")[0] || runtime.oracleTasksPackageId;
        const [taskEvents, messageEvents] = await Promise.all([
            queryTaskEventsByModule(client, taskPackageId, config.oracleTaskModule, taskId),
            queryTaskEventsByModule(client, taskPackageId, config.oracleMessageModule, taskId).catch(() => []),
        ]);
        const events = [...taskEvents, ...messageEvents].sort((a, b) => Number(a.timestampMs ?? 0) - Number(b.timestampMs ?? 0));
        res.json({
            taskId,
            packageId: taskPackageId,
            events,
        });
    }
    catch (error) {
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
        const network = typeof req.body.network === "string" ? req.body.network.trim() : "";
        const result = await prepareOracleTaskForWallet(req.body.task, sender, network ? setActiveNetwork(network) : undefined);
        res.json(result);
    }
    catch (error) {
        sendApiError(res, 500, error);
    }
});
app.post("/api/tasks/prepare-task-schedule-wallet", async (req, res) => {
    try {
        const task = req.body?.task;
        const schedule = req.body?.schedule;
        const sender = String(req.body?.sender ?? "").trim();
        const network = typeof req.body?.network === "string" ? req.body.network : undefined;
        if (!sender) {
            res.status(400).json({ error: "Body must include sender." });
            return;
        }
        if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
            res.status(400).json({ error: "Body must include schedule object." });
            return;
        }
        const prepared = await prepareOracleTaskScheduleForWallet(task, schedule, sender, network);
        res.json(prepared);
    }
    catch (error) {
        sendApiError(res, 400, error);
    }
});
app.post("/api/tasks/execute", async (req, res) => {
    try {
        if (typeof req.body !== "object" || req.body === null || !("task" in req.body)) {
            res.status(400).json({ error: 'Body must be { "task": ... }.' });
            return;
        }
        const network = typeof req.body.network === "string" ? req.body.network.trim() : "";
        const result = await executeOracleTask(req.body.task, network ? setActiveNetwork(network) : undefined);
        res.status(result.ok ? 200 : 500).json(result);
    }
    catch (error) {
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
    const runtime = getRuntimeConfig();
    console.log(`[iota_oracle_webview] listening on http://0.0.0.0:${config.port}`);
    console.log(`[iota_oracle_webview] client dir: ${config.oracleClientDir}`);
    console.log(`[iota_oracle_webview] examples dir: ${config.oracleExamplesDir}`);
    console.log(`[iota_oracle_webview] env cwd: ${envDebug.cwd}`);
    console.log(`[iota_oracle_webview] active network: ${getActiveNetwork()}`);
    console.log(`[iota_oracle_webview] supported networks: ${getSupportedNetworks().join(", ")}`);
    console.log(`[iota_oracle_webview] IOTA_RPC_URL loaded: ${runtime.rpcUrl ? "yes" : "no"}`);
    console.log(`[iota_oracle_webview] ORACLE_TASKS_PACKAGE_ID loaded: ${runtime.oracleTasksPackageId ? "yes" : "no"}`);
    console.log(`[iota_oracle_webview] ORACLE_SYSTEM_PACKAGE_ID loaded: ${runtime.oracleSystemPackageId ? "yes" : "no"}`);
    console.log(`[iota_oracle_webview] ORACLE_STATE_ID loaded: ${runtime.oracleStateId ? "yes" : "no"}`);
});
