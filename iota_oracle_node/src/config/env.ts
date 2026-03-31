export function mustEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

export function getTasksPackageId(): string {
  return process.env.ORACLE_TASKS_PACKAGE_ID?.trim() || mustEnv("ORACLE_PACKAGE_ID");
}

export function getSystemPackageId(): string {
  return (
    process.env.ORACLE_SYSTEM_PACKAGE_ID?.trim() ||
    process.env.ORACLE_PACKAGE_ID?.trim() ||
    mustEnv("ORACLE_PACKAGE_ID")
  );
}

export function getStateId(): string {
  return (
    process.env.ORACLE_STATE_ID?.trim() ||
    process.env.ORACLE_STATUS_ID?.trim() ||
    process.env.ORACLE_SYSTEM_STATE_ID?.trim() ||
    mustEnv("ORACLE_STATE_ID")
  );
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
