// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import fs from "node:fs";
import path from "node:path";

function stateDir(): string {
  const dir = path.resolve(process.cwd(), "keys");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function templateStatePath(nodeId: string): string {
  return path.join(stateDir(), `oracle_node_${nodeId}.accepted_templates.json`);
}

function normalizeTemplateIds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const out: number[] = [];
  for (const value of values) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) continue;
    if (!out.includes(n)) out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

export function loadPersistedAcceptedTemplateIds(nodeId: string): number[] {
  const fp = templateStatePath(nodeId);
  if (!fs.existsSync(fp)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf8")) as { acceptedTemplateIds?: unknown };
    return normalizeTemplateIds(raw?.acceptedTemplateIds);
  } catch (e: any) {
    console.warn(`[node ${nodeId}] accepted templates cache unreadable: ${String(e?.message ?? e)}`);
    return [];
  }
}

export function savePersistedAcceptedTemplateIds(nodeId: string, acceptedTemplateIds: number[]): void {
  const fp = templateStatePath(nodeId);
  const normalized = normalizeTemplateIds(acceptedTemplateIds);
  const payload = {
    nodeId,
    acceptedTemplateIds: normalized,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(fp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
