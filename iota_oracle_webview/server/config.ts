import "dotenv/config";
import path from "node:path";

function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function envAny(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

const rootDir = process.cwd();
const clientDir = path.resolve(rootDir, process.env.ORACLE_CLIENT_DIR ?? "../iota_oracle_client");
const examplesDirRaw = process.env.ORACLE_EXAMPLES_DIR?.trim() || process.env.ORACLE_CLIENT_EXAMPLES_DIR?.trim() || "examples";
const examplesDir = path.resolve(rootDir, examplesDirRaw);

export const config = {
  port: toNumber(process.env.PORT, 8787),
  network: (process.env.IOTA_NETWORK ?? "testnet").trim().toLowerCase(),
  rpcUrl: process.env.IOTA_RPC_URL ?? "https://api.testnet.iota.cafe",
  oracleTasksPackageId: envAny("ORACLE_TASKS_PACKAGE_ID", "ORACLE_PACKAGE_ID"),
  oracleSystemPackageId: envAny("ORACLE_SYSTEM_PACKAGE_ID", "ORACLE_PACKAGE_ID"),
  oracleStateId: envAny("ORACLE_STATE_ID", "ORACLE_SYSTEM_STATE_ID", "ORACLE_STATUS_ID"),
  oracleTaskModule: process.env.ORACLE_TASK_MODULE ?? "oracle_tasks",
  oracleMessageModule: process.env.ORACLE_MESSAGE_MODULE ?? "oracle_messages",
  activeWindowMinutes: toNumber(process.env.ACTIVE_WINDOW_MINUTES, 15),
  eventFetchLimit: toNumber(process.env.EVENT_FETCH_LIMIT, 100),
  oracleNodeAddresses: toList(process.env.ORACLE_NODE_ADDRESSES),
  oracleClientDir: clientDir,
  oracleExamplesDir: examplesDir,
};

export const envDebug = {
  cwd: rootDir,
  envFileLoaded: Boolean(
    process.env.ORACLE_TASKS_PACKAGE_ID ||
    process.env.ORACLE_SYSTEM_PACKAGE_ID ||
    process.env.ORACLE_PACKAGE_ID ||
    process.env.IOTA_RPC_URL ||
    process.env.PORT,
  ),
};
