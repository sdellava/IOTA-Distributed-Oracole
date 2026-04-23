// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import * as path from "node:path";
import { envByNetwork, getStateId, getSystemPackageId, getTasksPackageId, getTreasuryId, normalizeNetwork } from "./config/env.js";

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
  const network = ((normalizeNetwork(opt("IOTA_NETWORK", "devnet")) || "devnet") as Network) ?? "devnet";
  const oracleTasksPackageId = getTasksPackageId();
  const oracleSystemPackageId = getSystemPackageId();
  const oracleStateId = getStateId();
  const messageEventType = opt("MESSAGE_EVENT_TYPE") || `${oracleTasksPackageId}::oracle_messages::OracleMessage`;

  return {
    network,
    rpcUrl: opt("IOTA_RPC_URL") || envByNetwork("IOTA_RPC_URL"),
    oracleTasksPackageId,
    oracleSystemPackageId,
    oracleStateId,
    oracleTreasuryId: getTreasuryId(),
    keyFile: opt("KEY_FILE", path.join(".", "keys", "oracle.key.json"))!,
    useFaucet: optBool("USE_FAUCET", false),
    pollMs: optInt("POLL_MS", 2000),
    messageEventType,
    useWsSubscribe: optBool("USE_WS_SUBSCRIBE", false),
  };
}
