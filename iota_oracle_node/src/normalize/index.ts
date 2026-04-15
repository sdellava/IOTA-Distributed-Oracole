// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { JobOnchain } from "../types.js";
import { normalizeText } from "./text.js";
import { normalizeHtml } from "./html.js";
import { canonicalizeJson } from "./canonicalJson.js";

function deepDropKeys(value: unknown, drop: Set<string>, dropNulls: boolean, sortArrays: boolean): unknown {
  if (value === null) return dropNulls ? undefined : null;
  if (Array.isArray(value)) {
    const arr = value.map((v) => deepDropKeys(v, drop, dropNulls, sortArrays)).filter((v) => v !== undefined);
    if (sortArrays) {
      const withKey = arr.map((v) => ({ v, k: canonicalizeJson(v) }));
      withKey.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
      return withKey.map((x) => x.v);
    }
    return arr;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (drop.has(k)) continue;
      const vv = deepDropKeys(v, drop, dropNulls, sortArrays);
      if (vv === undefined) continue;
      out[k] = vv;
    }
    return out;
  }
  return value;
}

export function normalizeByJob(bodyText: string, job: JobOnchain): { normalized: string; kind: string } {
  const n = job.normalization;
  if (n.kind === "text") return { normalized: normalizeText(bodyText, { trim: n.trim ?? true, collapseWhitespace: n.collapseWhitespace ?? true, lineEnding: n.lineEnding ?? "lf" }), kind: "text" };
  if (n.kind === "html") return { normalized: normalizeHtml(bodyText, { removeScripts: n.removeScripts ?? true, removeStyles: n.removeStyles ?? true, stripComments: n.stripComments ?? true, collapseWhitespace: n.collapseWhitespace ?? true, dropPatterns: n.dropPatterns ?? [] }), kind: "html" };
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch (e) { throw new Error(`JSON parse failed: ${(e as Error).message}`); }
  const dropped = deepDropKeys(parsed, new Set(n.dropKeys ?? []), n.dropNulls ?? false, n.sortArrays ?? false);
  const stable = dropped === undefined ? null : dropped;
  return { normalized: canonicalizeJson(stable), kind: "json" };
}
