export function optBool(name: string, def = false): boolean {
  const v = process.env[name]?.trim();
  if (!v) return def;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

export function optInt(name: string, def: number): number {
  const v = process.env[name]?.trim();
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.floor(n);
}

export function parseAcceptedTemplateIds(raw = process.env.ORACLE_ACCEPTED_TEMPLATE_IDS ?? ""): number[] {
  const t = String(raw ?? "").trim();

  if (!t) {
    return [];
  }

  if (t === "*" || t.toLowerCase() === "all") {
    throw new Error(
      "ORACLE_ACCEPTED_TEMPLATE_IDS must be an explicit comma-separated list. Wildcards are no longer supported.",
    );
  }

  const out: number[] = [];
  for (const part of t.split(/[;,\s]+/)) {
    const s = part.trim();
    if (!s) continue;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      throw new Error(`Invalid ORACLE_ACCEPTED_TEMPLATE_IDS entry: ${s}`);
    }
    if (!out.includes(n)) out.push(n);
  }

  out.sort((a, b) => a - b);
  return out;
}

export function acceptsTemplate(templateId: number, acceptedTemplateIds: number[]): boolean {
  return acceptedTemplateIds.includes(templateId);
}
