// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

function parseNumberLike(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const t = x.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function tokenizePath(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(path ?? "")))) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push(Number(m[2]));
  }
  return out;
}

function deepGetByPath(root: unknown, path: string): unknown {
  const parts = tokenizePath(path);
  let cur: any = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof part === "number") {
      if (!Array.isArray(cur) || part < 0 || part >= cur.length) return undefined;
      cur = cur[part];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

type NumericCandidate = {
  path: string;
  value: number;
  score: number;
};

function collectNumericLeaves(
  root: unknown,
  path: Array<string | number> = [],
  out: NumericCandidate[] = [],
): NumericCandidate[] {
  const n = parseNumberLike(root);
  if (n != null) {
    out.push({ path: path.map(String).join("."), value: n, score: 0 });
    return out;
  }
  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i += 1) collectNumericLeaves(root[i], [...path, i], out);
    return out;
  }
  if (root && typeof root === "object") {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      collectNumericLeaves(v, [...path, k], out);
    }
  }
  return out;
}

function firstDefinedString(values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function scoreNumericCandidate(path: string, value: number): number {
  const parts = String(path ?? "")
    .split(".")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const leaf = parts[parts.length - 1] ?? "";
  const joined = parts.join(".");

  let score = 0;

  const strongPositive = [
    "value",
    "result",
    "price",
    "amount",
    "total",
    "rate",
    "ratio",
    "score",
    "metric",
    "measurement",
    "reading",
    "level",
    "mean",
    "avg",
    "average",
    "median",
    "temperature",
    "temp",
    "humidity",
    "pressure",
    "voltage",
    "current",
    "power",
    "speed",
    "distance",
    "weight",
    "height",
    "quantity",
    "count",
    "percent",
    "pct",
  ];
  const strongNegative = [
    "time",
    "timestamp",
    "date",
    "updated",
    "created",
    "interval",
    "latitude",
    "longitude",
    "lat",
    "lon",
    "lng",
    "id",
    "code",
    "status",
    "offset",
    "page",
    "limit",
    "size",
    "length",
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
  ];
  const parentPositive = ["current", "data", "quote", "stats", "metrics", "reading", "result", "values"];

  for (const tok of strongPositive) {
    if (leaf.includes(tok)) score += 120;
    else if (joined.includes(tok)) score += 40;
  }
  for (const tok of strongNegative) {
    if (leaf === tok || leaf.endsWith(`_${tok}`) || leaf.startsWith(`${tok}_`) || leaf.includes(tok)) score -= 140;
    else if (joined.includes(tok)) score -= 40;
  }
  for (const tok of parentPositive) {
    if (parts.slice(0, -1).some((p) => p.includes(tok))) score += 15;
  }

  if (!Number.isInteger(value)) score += 10;
  if (Math.abs(value) < 1_000_000) score += 5;
  if (parts.length > 1) score += Math.min(parts.length * 2, 10);

  return score;
}

function pickBestNumericCandidate(candidates: NumericCandidate[]): NumericCandidate | null {
  if (!candidates.length) return null;
  const scored = candidates.map((c) => ({ ...c, score: scoreNumericCandidate(c.path, c.value) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    return Math.abs(a.value) - Math.abs(b.value);
  });

  if (scored.length === 1) return scored[0];
  const best = scored[0];
  const second = scored[1];
  if (best.score <= 0 && second.score <= 0) return null;
  if (best.score === second.score && best.path !== second.path) return null;
  return best;
}

export function extractNumericValue(
  normalized: string,
  payloadJson: any,
): { value: number | null; path: string | null; source: string } {
  const t = normalized.trim();
  if (!t) return { value: null, path: null, source: "empty" };

  const configuredPath = firstDefinedString([
    payloadJson?.numericPath,
    payloadJson?.numeric_path,
    payloadJson?.valuePath,
    payloadJson?.value_path,
    payloadJson?.resultPath,
    payloadJson?.result_path,
    payloadJson?.numberPath,
    payloadJson?.number_path,
    payloadJson?.jsonPath,
    payloadJson?.json_path,
    payloadJson?.consensus?.numericPath,
    payloadJson?.consensus?.numeric_path,
    payloadJson?.consensus?.valuePath,
    payloadJson?.consensus?.value_path,
    payloadJson?.consensus?.resultPath,
    payloadJson?.consensus?.result_path,
    payloadJson?.consensus?.jsonPath,
    payloadJson?.consensus?.json_path,
    payloadJson?.mediation?.numericPath,
    payloadJson?.mediation?.numeric_path,
    payloadJson?.mediation?.valuePath,
    payloadJson?.mediation?.value_path,
    payloadJson?.mediation?.resultPath,
    payloadJson?.mediation?.result_path,
    payloadJson?.mediation?.jsonPath,
    payloadJson?.mediation?.json_path,
    payloadJson?.extraction?.path,
    payloadJson?.extraction?.numericPath,
    payloadJson?.extraction?.numeric_path,
    payloadJson?.extraction?.valuePath,
    payloadJson?.extraction?.value_path,
  ]);

  try {
    const parsed = JSON.parse(t);

    if (configuredPath) {
      const direct = parseNumberLike(deepGetByPath(parsed, configuredPath));
      if (direct != null) return { value: direct, path: configuredPath, source: "configured_path" };
    }

    const scalar = parseNumberLike(parsed);
    if (scalar != null) return { value: scalar, path: "$", source: "scalar" };

    if (Array.isArray(parsed) && parsed.length === 1) {
      const only = parseNumberLike(parsed[0]);
      if (only != null) return { value: only, path: "0", source: "single_array_value" };
    }

    const leaves = collectNumericLeaves(parsed, []);
    if (leaves.length === 1) return { value: leaves[0].value, path: leaves[0].path, source: "single_leaf" };

    const best = pickBestNumericCandidate(leaves);
    if (best) return { value: best.value, path: best.path, source: "heuristic_leaf" };
  } catch {
    if (/^-?\d+(?:\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return { value: n, path: "$", source: "raw_numeric_text" };
    }
  }

  return { value: null, path: null, source: configuredPath ? "configured_path_not_found" : "not_found" };
}

export function extractNumericScale(payloadJson: any): number {
  const raw = [
    payloadJson?.numericScale,
    payloadJson?.numeric_scale,
    payloadJson?.fixedPointScale,
    payloadJson?.fixed_point_scale,
    payloadJson?.consensus?.numericScale,
    payloadJson?.consensus?.numeric_scale,
    payloadJson?.consensus?.fixedPointScale,
    payloadJson?.consensus?.fixed_point_scale,
    payloadJson?.mediation?.scale,
    payloadJson?.mediation?.numericScale,
    payloadJson?.mediation?.numeric_scale,
    payloadJson?.mediation?.fixedPointScale,
    payloadJson?.mediation?.fixed_point_scale,
    payloadJson?.extraction?.scale,
  ].find((v) => v != null);

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}

export function toConsensusU64(value: number, scale: number): number | null {
  if (!Number.isFinite(value)) return null;
  const scaled = Math.round(value * scale);
  if (!Number.isSafeInteger(scaled) || scaled < 0) return null;
  return scaled;
}
