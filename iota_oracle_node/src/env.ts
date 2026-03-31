import * as path from "node:path";

export type Network = "devnet" | "testnet" | "mainnet" | "localnet";

function must(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env ${name}`);
  return String(v).trim();
}

function opt(name: string, def?: string): string | undefined {
  const v = process.env[name];
  const t = v == null ? "" : String(v).trim();
  return t ? t : def;
}

function optInt(name: string, def: number): number {
  const v = opt(name);
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid env ${name}: ${v}`);
  return Math.floor(n);
}

function optBool(name: string, def = false): boolean {
  const v = opt(name);
  if (!v) return def;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

export interface Env {
  network: Network;
  rpcUrl?: string;
  oracleTasksPackageId: string;
  oracleSystemPackageId: string;
  oracleStateId: string;
  oracleTreasuryId?: string;
  keyFile: string;
  useFaucet: boolean;
  pollMs: number;
  messageEventType: string;
  useWsSubscribe: boolean;
}

export function loadEnv(): Env {
  const network = (opt("IOTA_NETWORK", "devnet") as Network) ?? "devnet";
  const oracleTasksPackageId = must("ORACLE_TASKS_PACKAGE_ID");
  const oracleSystemPackageId = opt("ORACLE_SYSTEM_PACKAGE_ID", oracleTasksPackageId)!;
  const oracleStateId = must("ORACLE_STATE_ID");
  const messageEventType = opt("MESSAGE_EVENT_TYPE") || `${oracleTasksPackageId}::oracle_messages::OracleMessage`;

  return {
    network,
    rpcUrl: opt("IOTA_RPC_URL"),
    oracleTasksPackageId,
    oracleSystemPackageId,
    oracleStateId,
    oracleTreasuryId: opt("ORACLE_TREASURY_ID"),
    keyFile: opt("KEY_FILE", path.join(".", "keys", "oracle.key.json"))!,
    useFaucet: optBool("USE_FAUCET", false),
    pollMs: optInt("POLL_MS", 2000),
    messageEventType,
    useWsSubscribe: optBool("USE_WS_SUBSCRIBE", false),
  };
}
