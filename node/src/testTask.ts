// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import "dotenv/config";
import "./bootstrap.js";
import { Agent, setGlobalDispatcher } from "undici";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } as any }));
console.warn("[oracle-node:test] TLS certificate verification is DISABLED globally");

import fs from "node:fs";
import path from "node:path";

import { loadOrCreateNodeIdentity } from "./keys";
import { parseAcceptedTemplateIds } from "./nodeConfig";
import { executeTask } from "./taskExec";
import { getTaskHandler } from "./tasks/registry";
import { validateTemplatePolicy } from "./tasks/templatePolicy";
import { extractNumericScale, extractNumericValue, toConsensusU64 } from "./utils/numeric";

type TestArgs = {
  taskArg?: string;
  nodeId: string;
};

function parseArgs(argv: string[]): TestArgs {
  let taskArg: string | undefined;
  let nodeId = String(process.env.NODE_ID ?? "1").trim() || "1";

  for (let i = 2; i < argv.length; i += 1) {
    const current = String(argv[i] ?? "").trim();
    if (!current || current === "--") continue;

    if (current === "--node") {
      const next = String(argv[i + 1] ?? "").trim();
      if (!next) throw new Error("Missing value for --node");
      nodeId = next;
      i += 1;
      continue;
    }

    if (current.startsWith("--node=")) {
      nodeId = current.slice("--node=".length).trim();
      continue;
    }

    if (current.startsWith("--")) {
      throw new Error(`Unknown option: ${current}`);
    }

    if (!taskArg) {
      taskArg = current;
      continue;
    }

    throw new Error(`Unexpected extra argument: ${current}`);
  }

  return { taskArg, nodeId };
}

function defaultCandidatePaths(input: string): string[] {
  const cwd = process.cwd();
  const trimmed = input.trim();
  const baseName = path.basename(trimmed);

  return [
    path.resolve(cwd, trimmed),
    path.resolve(cwd, "examples", trimmed),
    path.resolve(cwd, "examples", baseName),
    path.resolve(cwd, "..", "client", trimmed),
    path.resolve(cwd, "..", "client", "examples", trimmed),
    path.resolve(cwd, "..", "client", "examples", baseName),
  ];
}

function loadTaskJson(taskArg?: string): { sourceLabel: string; taskObj: any } {
  if (!taskArg) {
    const defaults = [
      "task.json",
      "examples/task.json",
      "examples/task_weather.json",
      "../client/examples/task_weather.json",
    ];

    for (const candidate of defaults) {
      const full = path.resolve(process.cwd(), candidate);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return {
          sourceLabel: full,
          taskObj: JSON.parse(fs.readFileSync(full, "utf8")),
        };
      }
    }

    throw new Error("Usage: npm run test -- <task.json | inline-json> [--node 1]");
  }

  for (const candidate of defaultCandidatePaths(taskArg)) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    return {
      sourceLabel: candidate,
      taskObj: JSON.parse(fs.readFileSync(candidate, "utf8")),
    };
  }

  return {
    sourceLabel: "<inline-json>",
    taskObj: JSON.parse(taskArg),
  };
}

function parsePositiveInt(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function resolveRequestedNodes(taskObj: any): number {
  return parsePositiveInt(taskObj?.requested_nodes ?? taskObj?.nodes, 0);
}

function resolveQuorum(taskObj: any, requestedNodes: number): string {
  const q = taskObj?.consensus?.quorum;
  if (!q) return requestedNodes > 0 ? `default=${requestedNodes}` : "default=<not specified>";

  const type = String(q.type ?? "").trim() || "<unknown>";
  const value = q.value == null ? "<missing>" : String(q.value);
  return `${type}:${value}`;
}

function truncate(text: string, max = 600): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function summarizeEnv(taskType: string) {
  const lines = [
    `IOTA_NETWORK=${String(process.env.IOTA_NETWORK ?? "<unset>")}`,
    `NODE_SUPPORTED_TEMPLATES_SOURCE=on-chain`,
  ];

  if (taskType === "STORAGE") {
    lines.push(`IPFS_ENABLED=${String(process.env.IPFS_ENABLED ?? "<unset>")}`);
    lines.push(`IPFS_API_URL=${String(process.env.IPFS_API_URL ?? "<unset>")}`);
  }

  return lines;
}

async function main() {
  const { taskArg, nodeId } = parseArgs(process.argv);
  if (!/^[0-9]+$/.test(nodeId)) throw new Error(`--node must be numeric (got "${nodeId}")`);

  const { sourceLabel, taskObj } = loadTaskJson(taskArg);
  const identity = loadOrCreateNodeIdentity(nodeId);
  const acceptedTemplateIds = parseAcceptedTemplateIds();

  const taskType = String(taskObj?.type ?? "").trim();
  const templateId = parsePositiveInt(taskObj?.template_id ?? taskObj?.templateId, 0);
  const requestedNodes = resolveRequestedNodes(taskObj);
  const retentionDays = Number(taskObj?.retention_days ?? taskObj?.retentionDays ?? 0) || 0;
  const declaredDownloadBytes = Number(
    taskObj?.declared_download_bytes ??
      taskObj?.declaredDownloadBytes ??
      taskObj?.source?.declared_download_bytes ??
      taskObj?.source?.declaredDownloadBytes ??
      0,
  );
  const handler = getTaskHandler(taskType);

  console.log("=== ORACLE NODE TASK TEST ===");
  console.log(`task_source: ${sourceLabel}`);
  console.log(`node_id: ${nodeId}`);
  console.log(`node_address: ${identity.address}`);
  console.log(`task_type: ${taskType || "<missing>"}`);
  console.log(`template_id: ${templateId || "<missing>"}`);
  console.log(`requested_nodes: ${requestedNodes || "<missing>"}`);
  console.log(`quorum: ${resolveQuorum(taskObj, requestedNodes)}`);
  console.log(`retention_days: ${retentionDays}`);
  console.log(`declared_download_bytes: ${declaredDownloadBytes}`);
  console.log(`handler_found: ${handler ? "yes" : "no"}`);
  console.log(`template_accepted_by_local_test_env: ${templateId > 0 && acceptedTemplateIds.includes(templateId) ? "yes" : "no"}`);
  console.log(`local_test_accepted_templates: ${acceptedTemplateIds.length ? acceptedTemplateIds.join(",") : "<none>"}`);
  console.log("--- ENV ---");
  for (const line of summarizeEnv(taskType)) console.log(line);
  console.log("--- INPUT PAYLOAD PREVIEW ---");
  console.log(truncate(JSON.stringify(taskObj, null, 2), 2500));

  if (!taskType) throw new Error('Task JSON must contain a non-empty top-level "type" field');
  if (!handler) throw new Error(`Unsupported task type: ${taskType}`);

  validateTemplatePolicy(taskType, taskObj, templateId || undefined);
  console.log("template_policy_check: ok");

  console.log("--- EXECUTION ---");
  const startedAt = Date.now();
  const normalized = await executeTask({
    taskType,
    payload: taskObj,
    taskId: "local-test-task",
    nodeId,
    templateId: templateId || undefined,
    declaredDownloadBytes: declaredDownloadBytes > 0 ? declaredDownloadBytes : undefined,
    retentionDays,
    taskCreatedAtMs: Date.now(),
  });
  const elapsedMs = Date.now() - startedAt;
  console.log(`execution_status: ok`);
  console.log(`execution_time_ms: ${elapsedMs}`);
  console.log(`normalized_length: ${normalized.length}`);

  let normalizedJson: any = null;
  try {
    normalizedJson = JSON.parse(normalized);
    console.log("normalized_is_json: yes");
  } catch {
    console.log("normalized_is_json: no");
  }

  const numericScale = extractNumericScale(taskObj);
  const numeric = extractNumericValue(normalized, taskObj);
  console.log("--- CONSENSUS HINTS ---");
  console.log(`numeric_extract_source: ${numeric.source}`);
  console.log(`numeric_extract_path: ${numeric.path ?? "<none>"}`);
  console.log(`numeric_extract_value: ${numeric.value ?? "<none>"}`);
  console.log(`numeric_scale: ${numericScale}`);
  console.log(`numeric_u64: ${numeric.value == null ? "<none>" : String(toConsensusU64(numeric.value, numericScale))}`);

  if (normalizedJson && typeof normalizedJson === "object") {
    console.log(`normalized_top_level_keys: ${Object.keys(normalizedJson).join(",") || "<none>"}`);
  }

  console.log("--- NORMALIZED OUTPUT PREVIEW ---");
  console.log(truncate(normalized, 4000));
  console.log("--- RESULT ---");
  console.log("This node can execute the task handler locally with the current environment.");
  console.log("This does not prove on-chain assignment, quorum, publish, or finalization.");
}

main().catch((e) => {
  const err = e as any;
  console.error("=== ORACLE NODE TASK TEST FAILED ===");
  console.error(`message: ${err?.message ?? String(err)}`);
  if (err?.stack) {
    console.error("--- STACK ---");
    console.error(String(err.stack));
  }
  process.exit(1);
});
