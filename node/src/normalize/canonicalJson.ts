// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export function canonicalizeJson(value: unknown): string {
  const v = value as Json;
  return stringifyCanonical(v);
}
function stringifyCanonical(v: Json): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") { if (!Number.isFinite(v)) return "null"; return JSON.stringify(v); }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stringifyCanonical).join(",") + "]";
  const keys = Object.keys(v).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + stringifyCanonical(v[k]!));
  return "{" + parts.join(",") + "}";
}
