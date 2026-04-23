// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

export function mustEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

export function networkPrefix(): "DEVNET" | "TESTNET" | "MAINNET" | "" {
  const net = (process.env.IOTA_NETWORK ?? "").trim().toLowerCase();
  if (net === "dev" || net === "devnet" || net === "local" || net === "localnet") return "DEVNET";
  if (net === "test" || net === "testnet") return "TESTNET";
  if (net === "main" || net === "mainnet") return "MAINNET";
  return "";
}

export function envByNetwork(baseKey: string): string | undefined {
  const prefix = networkPrefix();
  if (prefix) {
    const v = process.env[`${prefix}_${baseKey}`]?.trim();
    if (v) return v;
  }
  const direct = process.env[baseKey]?.trim();
  if (direct) return direct;
  return undefined;
}

export function getTasksPackageId(): string {
  return envByNetwork("ORACLE_TASKS_PACKAGE_ID") || mustEnv("ORACLE_PACKAGE_ID");
}

export function getSystemPackageId(): string {
  return (
    envByNetwork("ORACLE_SYSTEM_PACKAGE_ID") ||
    envByNetwork("ORACLE_PACKAGE_ID") ||
    mustEnv("ORACLE_PACKAGE_ID")
  );
}

export function getStateId(): string {
  return (
    envByNetwork("ORACLE_STATE_ID") ||
    envByNetwork("ORACLE_STATUS_ID") ||
    envByNetwork("ORACLE_SYSTEM_STATE_ID") ||
    mustEnv("ORACLE_STATE_ID")
  );
}

export function getConfiguredNodeRegistryId(): string | undefined {
  return envByNetwork("ORACLE_NODE_REGISTRY_ID");
}

export function getTreasuryId(): string {
  return (
    envByNetwork("ORACLE_TREASURY_ID") ||
    envByNetwork("ORACLE_TREASURY_OBJECT_ID") ||
    mustEnv("ORACLE_TREASURY_ID")
  );
}

export function getRandomId(): string {
  return (envByNetwork("IOTA_RANDOM_OBJECT_ID") || "0x8").trim() || "0x8";
}

export function getClockId(): string {
  return (envByNetwork("IOTA_CLOCK_OBJECT_ID") || envByNetwork("IOTA_CLOCK_ID") || "0x6").trim() || "0x6";
}

export function getTaskSchedulerQueueId(): string {
  return envByNetwork("ORACLE_TASK_SCHEDULER_QUEUE_ID") || mustEnv("ORACLE_TASK_SCHEDULER_QUEUE_ID");
}

export function getTaskRegistryId(): string {
  return envByNetwork("ORACLE_TASK_REGISTRY_ID") || mustEnv("ORACLE_TASK_REGISTRY_ID");
}

export function defaultEventType(envKey: string, suffix: string): string {
  const v = process.env[envKey]?.trim();
  if (v) return v;
  const pkg = getTasksPackageId();
  return `${pkg}::${suffix}`;
}

export function parseNodeId(argv: string[]): string {
  const args = argv.slice(2);

  const pos = args.find((a) => a && !a.startsWith("-"));
  if (pos) return String(pos).trim();

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--node" && args[i + 1]) return String(args[i + 1]).trim();
    if (a.startsWith("--node=")) return a.slice("--node=".length).trim();
  }

  return (process.env.NODE_ID ?? "1").trim();
}
