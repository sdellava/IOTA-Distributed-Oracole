// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

function parseNodeIdFromArgv(argv: string[]): string {
  const args = argv.slice(2);

  const positional = args.find((arg) => arg && !arg.startsWith("-"));
  if (positional) return String(positional).trim();

  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] ?? "").trim();
    if (arg === "--node" && args[i + 1]) return String(args[i + 1]).trim();
    if (arg.startsWith("--node=")) return arg.slice("--node=".length).trim();
  }

  return String(process.env.NODE_ID ?? "1").trim() || "1";
}

function isTruthy(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function applyNodeScopedEnv(nodeId = parseNodeIdFromArgv(process.argv)): void {
  const normalizedNodeId = String(nodeId ?? "").trim();
  if (!normalizedNodeId) return;

  const prefix = `NODE_${normalizedNodeId}_`;
  const aliases: Record<string, string> = {
    NETWORK: "IOTA_NETWORK",
  };

  let applied = 0;
  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || rawValue == null) continue;
    const suffix = key.slice(prefix.length);
    if (!suffix) continue;
    const targetKey = aliases[suffix] ?? suffix;
    process.env[targetKey] = String(rawValue);
    applied += 1;
  }

  process.env.NODE_ID = normalizedNodeId;
  if (applied > 0) {
    console.log(`[node ${normalizedNodeId}] applied ${applied} node-scoped env override(s) from ${prefix}*`);
  }
}

applyNodeScopedEnv();

export function shouldDisableTlsVerification(): boolean {
  return isTruthy(process.env.ORACLE_HTTP_INSECURE_TLS);
}

export { applyNodeScopedEnv, parseNodeIdFromArgv };
