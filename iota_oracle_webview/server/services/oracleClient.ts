import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { config } from "../config.js";

function npmCommand(): string {
  return "npm";
}

async function buildClientEnv(): Promise<NodeJS.ProcessEnv> {
  const envPath = path.join(config.oracleClientDir, ".env");
  let parsed: Record<string, string> = {};

  try {
    const raw = await fs.readFile(envPath, "utf8");
    parsed = dotenv.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    ...process.env,

    ORACLE_PACKAGE_ID: "",
    ORACLE_SYSTEM_STATE_ID: "",
    ORACLE_STATUS_ID: "",

    ...parsed,
  };
}

async function spawnClientCommand(args: string[]) {
  const env = await buildClientEnv();
  const effectiveArgs = ["--silent", ...args];

  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "npm", ...effectiveArgs], {
      cwd: config.oracleClientDir,
      shell: false,
      env,
    });
  }

  return spawn(npmCommand(), effectiveArgs, {
    cwd: config.oracleClientDir,
    shell: false,
    env,
  });
}

function extractJsonFromStdout(stdout: string): any {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Wallet preparation returned empty stdout.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    const candidate = trimmed.slice(firstBrace).trim();
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error(`Wallet preparation did not return valid JSON. Raw stdout:
${stdout}`);
}

function normalizeTaskPayloadInput(input: unknown): Record<string, unknown> {
  let value: unknown = input;

  if (typeof value === "string") {
    value = JSON.parse(value);
  }

  if (!value || typeof value !== "object") {
    throw new Error("Task payload must be a JSON object.");
  }

  const record = value as Record<string, unknown>;

  const unwrapped = record.task ?? record.payload ?? record.taskJson ?? record.json ?? record;

  let task: unknown = unwrapped;

  if (typeof task === "string") {
    task = JSON.parse(task);
  }

  if (!task || typeof task !== "object") {
    throw new Error("Normalized task payload must be a JSON object.");
  }

  const normalized = { ...(task as Record<string, unknown>) };

  if (typeof normalized.template_id === "string" && /^\d+$/.test(normalized.template_id)) {
    normalized.template_id = Number(normalized.template_id);
  }

  if (typeof normalized.template_id !== "number" || !Number.isFinite(normalized.template_id)) {
    throw new Error('Task JSON must contain numeric "template_id"');
  }

  return normalized;
}

async function spawnCreateTask(taskFilePath: string) {
  return spawnClientCommand(["run", "create", "--", taskFilePath]);
}

async function spawnPrepareWalletTask(taskFilePath: string, sender: string) {
  return spawnClientCommand(["run", "create", "--", "prepare-webview", taskFilePath, sender]);
}

export async function listExampleTasks() {
  try {
    const entries = await fs.readdir(config.oracleExamplesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => ({
        name: entry.name,
        path: path.join(config.oracleExamplesDir, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function readExampleTask(exampleName: string) {
  await fs.access(config.oracleExamplesDir).catch(() => {
    throw new Error(`Oracle examples directory not found: ${config.oracleExamplesDir}`);
  });

  const fullPath = path.resolve(config.oracleExamplesDir, exampleName);
  if (!fullPath.startsWith(config.oracleExamplesDir)) {
    throw new Error("Invalid example path.");
  }

  const content = await fs.readFile(fullPath, "utf8");
  return JSON.parse(content);
}

export async function prepareOracleTaskForWallet(task: unknown, sender: string) {
  await fs.access(config.oracleClientDir).catch(() => {
    throw new Error(`Oracle client directory not found: ${config.oracleClientDir}`);
  });

  const normalizedSender = String(sender ?? "").trim();
  if (!normalizedSender) {
    throw new Error("Wallet sender address is required.");
  }

  const normalizedTask = normalizeTaskPayloadInput(task);

  await fs.mkdir(path.join(os.tmpdir(), "iota_oracle_webview"), { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "iota_oracle_webview", "task-"));
  const taskFilePath = path.join(tempDir, "task.json");
  await fs.writeFile(taskFilePath, `${JSON.stringify(normalizedTask, null, 2)}\n`, "utf8");

  const startedAt = new Date().toISOString();

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>(async (resolve, reject) => {
    const child = await spawnPrepareWalletTask(taskFilePath, normalizedSender);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Wallet preparation failed with exit code ${String(result.exitCode)}`,
    );
  }

  const parsed = extractJsonFromStdout(result.stdout);

  return {
    ...parsed,
    cwd: config.oracleClientDir,
    command:
      process.platform === "win32"
        ? `cmd.exe /d /s /c npm --silent run create -- prepare-webview ${taskFilePath} ${normalizedSender}`
        : `${npmCommand()} --silent run create -- prepare-webview ${taskFilePath} ${normalizedSender}`,
    taskFilePath,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

export async function executeOracleTask(task: unknown) {
  await fs.access(config.oracleClientDir).catch(() => {
    throw new Error(`Oracle client directory not found: ${config.oracleClientDir}`);
  });

  const normalizedTask = normalizeTaskPayloadInput(task);

  await fs.mkdir(path.join(os.tmpdir(), "iota_oracle_webview"), { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "iota_oracle_webview", "task-"));
  const taskFilePath = path.join(tempDir, "task.json");
  await fs.writeFile(taskFilePath, `${JSON.stringify(normalizedTask, null, 2)}\n`, "utf8");

  const startedAt = new Date().toISOString();

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>(async (resolve, reject) => {
    const child = await spawnCreateTask(taskFilePath);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });

  return {
    ok: result.exitCode === 0,
    cwd: config.oracleClientDir,
    command:
      process.platform === "win32"
        ? `cmd.exe /d /s /c npm --silent run create -- ${taskFilePath}`
        : `${npmCommand()} --silent run create -- ${taskFilePath}`,
    taskFilePath,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
